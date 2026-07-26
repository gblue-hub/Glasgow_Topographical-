/** Interactive controls keep their native keyboard behaviour. */
export function shouldIgnoreLessonShortcut(target: HTMLElement) {
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  ) return true;

  return Boolean(target.closest("button, a, [role='button']"));
}
