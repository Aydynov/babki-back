import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mongo } from 'mongoose';

/** Starts a disposable database, never connects to a developer/production DB. */
export async function startTestReplicaSet() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const directory = await mkdtemp(join(tmpdir(), 'babki-groups-mongo-'));
  const child = spawn(
    process.env.MONGOD_BINARY ?? 'mongod',
    [
      '--dbpath',
      directory,
      '--port',
      String(port),
      '--bind_ip',
      '127.0.0.1',
      '--replSet',
      'babki_test',
      '--oplogSize',
      '64',
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let startError: Error | undefined;
  child.on('error', (error) => {
    startError = error;
  });
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-4000);
  });
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  const client = new mongo.MongoClient(uri, { serverSelectionTimeoutMS: 500 });
  async function close() {
    await client.close();
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await ended;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 30_000;
    while (true) {
      if (startError) throw startError;
      if (child.exitCode !== null) throw new Error(`mongod exited: ${output}`);
      try {
        await client.connect();
        break;
      } catch {
        if (Date.now() >= deadline)
          throw new Error(`mongod not ready: ${output}`);
        await delay(100);
      }
    }
    await client.db('admin').command({
      replSetInitiate: {
        _id: 'babki_test',
        members: [{ _id: 0, host: `127.0.0.1:${port}` }],
      },
    });
    while (true) {
      const hello = await client.db('admin').command({ hello: 1 });
      if (hello.isWritablePrimary) break;
      if (Date.now() >= deadline)
        throw new Error('Test replica set has no primary');
      await delay(100);
    }
    await client.close();
    return {
      port,
      uri: `mongodb://127.0.0.1:${port}/babki_groups_test?replicaSet=babki_test&directConnection=true`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
