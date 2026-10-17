/** Keeps invitation query secrets out of application logs and error metadata. */
export function isInvitationRequest(url: string): boolean {
  return /\/group-invitations\/(preview|accept)\/?$/i.test(
    url.split('?', 1)[0],
  );
}

export function invitationRequestPath(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  return isInvitationRequest(path) ? path : url;
}
