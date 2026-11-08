# Review loop: unprompted-use check

Run before release. It calls the real model, so it is not in CI.

1. Start the app, open a project and start a new Claude chat.
2. Send, without naming any UI element:

   ```text
   Write me a short plan for adding image uploads to a notes app.
   ```

   **Pass:** the reply contains a `:::doc id=… title=…` block and renders as a document card (v1).
3. Select a sentence in the document. Choose Comment and write "use object storage instead". Select another sentence and choose Redline. Both appear in the tray and the passages are highlighted.
4. Reload the page. **Pass:** both marks are still in the tray.
5. Press send with the input empty. **Pass:** the user message shows two quote cards and the tray is empty.
6. **Pass:** Claude's reply repeats the same id with `addresses=` naming both marks, and renders as v2 with changes marked and chips for m1 and m2. "Hide changes" shows the clean text.
7. **Pass:** v1 stays above, and both passages show a discussion badge.
8. Select a word in v2, choose Ask, write "why this?" and send. **Pass:** Claude answers in prose and writes no v3.
9. Switch the session to plan mode and ask for a plan. Comment on the plan and send. **Pass:** the plan card shows the feedback, and the next plan shows as v2 with changes. Press Build. **Pass:** Claude proceeds.
10. Open the session in a fresh tab. **Pass:** version numbers and badges are unchanged, even with more than 20 rows.
