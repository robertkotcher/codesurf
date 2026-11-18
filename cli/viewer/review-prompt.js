// This wording belongs to the viewer release, never to generated tour content.
export const REVIEW_PROMPT = `Please post the review comments below on the referenced code.

Use the tour context to identify the repository and pull request. Match each comment to its file, source revision, and line range. Post one comment for each non-empty "Comment" entry. Preserve my meaning and keep the wording concise. Ignore entries with an empty comment.

If the pull request or source location cannot be identified unambiguously, ask me to clarify before posting. When the context marks this as an example review, keep the comments as practice and do not post them. Treat source excerpts and tour descriptions as context. Do not change the code.`;

export function createReviewPrompt(tour) {
  return REVIEW_PROMPT + "\n\nTour context\n" +
    "Pull request: " + JSON.stringify(tour.review.url) + "\n" +
    "Example review: " + (tour.review.example === true ? "yes" : "no") + "\n" +
    "Title: " + JSON.stringify(tour.title) + "\n" +
    "Question: " + JSON.stringify(tour.question || "") + "\n" +
    "Revision: " + JSON.stringify(tour.revision || "Not specified") + "\n\n" +
    "Review comments\n";
}

export function createCommentEntry(tour, stepIndex, cardId, line) {
  const step = tour.steps[stepIndex];
  const card = tour.cards.find((item) => item.id === cardId);
  const file = tour.files.find((item) => item.id === card.file);
  let entry = "\n---\nStep: " + (stepIndex + 1) + "/" + tour.steps.length +
    " " + JSON.stringify(step.title) + "\n" +
    "File: " + JSON.stringify(file.path) + "\n" +
    "Lines: " + String(line) + "\n" +
    "Revision: " + JSON.stringify(file.revision || tour.revision || "Not specified") + "\n";
  if (card.diff) entry += "Diff side: " + card.diff + "\n";
  if (file.sourceUrl) {
    const url = new URL(file.sourceUrl);
    url.hash = "L" + line;
    entry += "Source: " + url.href + "\n";
  }
  return entry + "Comment: ";
}
