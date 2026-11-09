const SCROLL_IDLE_MS = 150;
const MAX_WAIT_MS = 5000;
/** Closer to the top than this, the user is about to run out of content. */
const FORCE_COMMIT_TOP_PX = 300;

/**
 * Resolves once the transcript stops moving, so prepending a page does not
 * interrupt a flick: iOS momentum overwrites any scrollTop set while it runs.
 * Resolves early when the user nears the top, where the new rows are needed
 * now, and after a cap so a held finger cannot block history loading forever.
 */
export function waitForScrollToSettle(
  container: HTMLElement,
  isTouching: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      container.removeEventListener('scroll', onScroll);
      resolve();
    };
    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (isTouching()) armIdleTimer();
        else finish();
      }, SCROLL_IDLE_MS);
    };
    const onScroll = () => {
      if (container.scrollTop <= FORCE_COMMIT_TOP_PX) finish();
      else armIdleTimer();
    };

    const maxTimer = setTimeout(finish, MAX_WAIT_MS);
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
}
