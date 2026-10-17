import { invitationRequestPath } from './invitation-request-path';

describe('invitationRequestPath', () => {
  it.each([
    ['/group-invitations/preview?token=secret', '/group-invitations/preview'],
    [
      '/api/v1/group-invitations/accept?token=secret',
      '/api/v1/group-invitations/accept',
    ],
    [
      '/custom/prefix/GROUP-INVITATIONS/PREVIEW/?anything=secret',
      '/custom/prefix/GROUP-INVITATIONS/PREVIEW/',
    ],
    [
      '/group-invitations/ACCEPT/?token=secret?more=secret',
      '/group-invitations/ACCEPT/',
    ],
    ['/api/v1/group-invitations/preview', '/api/v1/group-invitations/preview'],
    ['/api/v1/accounts?sort=name', '/api/v1/accounts?sort=name'],
    [
      '/group-invitations/preview-extra?token=secret',
      '/group-invitations/preview-extra?token=secret',
    ],
    [
      '/not-group-invitations/accept?token=secret',
      '/not-group-invitations/accept?token=secret',
    ],
    [
      '/group-invitations/accept/history?sort=date',
      '/group-invitations/accept/history?sort=date',
    ],
    [
      '/groups?redirect=/group-invitations/accept&token=secret',
      '/groups?redirect=/group-invitations/accept&token=secret',
    ],
  ])('returns safe metadata for %s', (url, expected) => {
    expect(invitationRequestPath(url)).toBe(expected);
  });
});
