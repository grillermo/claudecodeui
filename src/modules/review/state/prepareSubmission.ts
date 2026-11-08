type PrepareSubmissionInput = {
  typed: string;
  hasMarks: boolean;
  /** A queued message being flushed: its feedback block was composed when it was queued. */
  isQueuedResend: boolean;
  composeFeedback(typed: string): string;
};

/** What the composer should send, and whether doing so uses up the tray. */
export function prepareSubmission(input: PrepareSubmissionInput): { text: string; consumedMarks: boolean } {
  const { typed, hasMarks, isQueuedResend, composeFeedback } = input;
  // A block in front of a slash command would stop it being a command.
  if (!hasMarks || isQueuedResend || typed.trimStart().startsWith('/')) {
    return { text: typed, consumedMarks: false };
  }
  return { text: composeFeedback(typed), consumedMarks: true };
}
