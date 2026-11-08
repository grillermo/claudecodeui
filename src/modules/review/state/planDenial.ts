type PermissionRequestLike = { requestId: string; toolName?: string };

type FindPlanRequestInput<T> = {
  requests: T[];
  text: string;
  hasAttachments: boolean;
  isQueuedResend: boolean;
};

/**
 * The pending ExitPlanMode request this message should answer, if any.
 * A denial carries only text, so a message with attachments takes the normal
 * path, as does a slash command, which is an instruction to the CLI.
 */
export function findPlanRequestToDeny<T extends PermissionRequestLike>(input: FindPlanRequestInput<T>): T | null {
  const { requests, text, hasAttachments, isQueuedResend } = input;
  if (hasAttachments || isQueuedResend || text.trimStart().startsWith('/')) {
    return null;
  }
  return requests.find((request) => (
    request.toolName === 'ExitPlanMode' || request.toolName === 'exit_plan_mode'
  )) ?? null;
}
