import { invitationRequestPath } from './invitation-request-path';

describe('invitationRequestPath', () => {
  it.each([
    ['/space-invitations/preview?token=secret', '/space-invitations/preview'],
    [
      '/api/v1/space-invitations/accept?token=secret',
      '/api/v1/space-invitations/accept',
    ],
    [
      '/custom/prefix/SPACE-INVITATIONS/PREVIEW/?anything=secret',
      '/custom/prefix/SPACE-INVITATIONS/PREVIEW/',
    ],
    [
      '/space-invitations/ACCEPT/?token=secret?more=secret',
      '/space-invitations/ACCEPT/',
    ],
    ['/api/v1/space-invitations/preview', '/api/v1/space-invitations/preview'],
    ['/api/v1/accounts?sort=name', '/api/v1/accounts?sort=name'],
    [
      '/space-invitations/preview-extra?token=secret',
      '/space-invitations/preview-extra?token=secret',
    ],
    [
      '/not-space-invitations/accept?token=secret',
      '/not-space-invitations/accept?token=secret',
    ],
    [
      '/space-invitations/accept/history?sort=date',
      '/space-invitations/accept/history?sort=date',
    ],
    [
      '/spaces?redirect=/space-invitations/accept&token=secret',
      '/spaces?redirect=/space-invitations/accept&token=secret',
    ],
  ])('returns safe metadata for %s', (url, expected) => {
    expect(invitationRequestPath(url)).toBe(expected);
  });
});
