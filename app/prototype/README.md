# DiaScale UI prototype

Throwaway frontend based on the interface illustrations on PDF pages 17–18. Selected design: the compact clinical risk card with an integrated measurement button, followed by a risk-score history chart. Dates use dd/mm. Alternative designs and the prototype selector have been removed.

Run `npm run prototype` from the project directory and open http://localhost:4173. Use any phone number; there is no OTP step. Signup requires both profile steps. Login opens an example account; `?demo=1` opens its home directly.

The canvas remains 390 × 844 CSS pixels and scales to fit the browser. The outer page cannot scroll; app content scrolls inside the phone. Risk history plots the most recent six measurements on a fixed 0–100 scale. Empty and single-measurement states are supported.

No backend, real Bluetooth, or clinical risk algorithm. All data lives in memory and resets on reload. Displayed scores are examples, not medical decision support. Each completed measurement records a profile snapshot; editing the current profile does not rewrite past results.

No repository commit was made: this directory inherits a Git repository rooted outside the project. Capture/integration should use a dedicated DiaScale repository.
