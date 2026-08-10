export function questionBlockHTML(question, index, userAnswer, showFeedback) {
  const answered = typeof userAnswer === 'string' && userAnswer.trim().length > 0

  return `
    <div class="question-block" data-qid="${question.id}">
      <p class="question-text">${index + 1}. ${escapeHtml(question.text)}</p>
      <textarea class="question-answer" data-qid="${question.id}" rows="2" placeholder="Write your answer…">${escapeHtml(userAnswer || '')}</textarea>
      ${
        showFeedback
          ? `<p class="question-feedback">
              ${answered ? 'Your answer above.' : '— no answer given —'}
              <span class="text-muted">Model answer: "${escapeHtml(question.correctAnswer)}" — Paragraph ${question.paragraphRef + 1}</span>
            </p>`
          : ''
      }
    </div>
  `
}

export function wireQuestionBlock(root, question, onAnswer) {
  const textarea = root.querySelector(`textarea[data-qid="${question.id}"]`)
  textarea?.addEventListener('blur', () => onAnswer(question.id, textarea.value))
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
