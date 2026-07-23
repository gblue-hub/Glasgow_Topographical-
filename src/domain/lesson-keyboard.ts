/**
 * Answer choices deliberately keep the lesson's Space = Check/Next shortcut.
 * Other interactive controls keep their native keyboard behaviour.
 */
export function shouldIgnoreLessonShortcut(target: HTMLElement) {
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  ) return true;

  const answerOption = target.closest(".mc-options button");
  if (answerOption) return false;

  return Boolean(target.closest("button, a, [role='button']"));
}
