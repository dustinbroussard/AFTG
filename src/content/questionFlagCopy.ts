const QUESTION_FLAG_LINES = [
  "Think this question kind of sucks? Flag it. We'll rough it up later.",
  "Was this question sketchy? Mark it and we'll take a look.",
  "Think this one was weak? Flag it and we'll interrogate it later.",
  "Did this question feel off? Mark it. We're not above a manual beating.",
];

export function getRandomQuestionFlagLine() {
  return QUESTION_FLAG_LINES[Math.floor(Math.random() * QUESTION_FLAG_LINES.length)];
}
