import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { runSeeders } from './seeds/index';
async function bootstrap() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error(
      `Seed script can only run in NODE_ENV=development. Current: ${process.env.NODE_ENV ?? 'unset'}`,
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    await runSeeders(app);
    console.log('\n✅ Seeding complete');
  } catch (err) {
    console.error('\n❌ Seeding failed:', err);
    process.exit(1);
  } finally {
    await app.close();
  }
}
void bootstrap();
