# Changes

## Step 1: Input safety (2026-11-21)

Goal: stop the API from returning wrong predictions for bad input, and remove the
training/serving mismatch on `loan_percent_income`. The model file
(`credit_risk_model.pkl`) is unchanged.

### `main.py`: request validation

| Where | What changed | Why |
|---|---|---|
| [main.py:3](main.py#L3), [main.py:11](main.py#L11) | Imported `Literal`, `ConfigDict`, `Field`, `computed_field`, `model_validator`. | Needed for the new validation. |
| [main.py:45-95](main.py#L45-L95) | `LoanApplication` rewritten with constraints (table below). | Before, any value was accepted. Example: age `-5` with income `-1` returned a default probability of 1.0. |
| [main.py:47](main.py#L47) | `extra="forbid"`: unknown fields are rejected with 422. | Typos in field names are no longer silently ignored. |
| [main.py:47](main.py#L47) | Added an example request to the schema. | `/docs` now has a ready-to-run example. |
| [main.py:82-86](main.py#L82-L86) | `check_emp_length_vs_age` rejects `person_emp_length > person_age - 14`. | Same rule as the frontend. It only rejects the 2 impossible rows in the dataset (employment length of 123 years). |
| [main.py:88-95](main.py#L88-L95) | `loan_percent_income` is now a **computed field**: `round(loan_amnt / person_income, 2)`. | It used to come from the client. A client could send any value, and that alone moved the prediction from 4.8% to 25.8% for the same applicant. The server now derives it the same way the training data does. |

Field constraints:

| Field | Rule |
|---|---|
| `person_age` | integer, 18–100 |
| `person_income` | > 0, ≤ 10,000,000, no NaN/Infinity |
| `person_home_ownership` | one of `RENT`, `MORTGAGE`, `OWN`, `OTHER` |
| `person_emp_length` | 0–60, and ≤ age − 14 |
| `loan_intent` | one of `PERSONAL`, `EDUCATION`, `MEDICAL`, `VENTURE`, `HOMEIMPROVEMENT`, `DEBTCONSOLIDATION` |
| `loan_grade` | one of `A`–`G` |
| `loan_amnt` | > 0, ≤ 35,000 (the dataset maximum) |
| `loan_int_rate` | > 0, ≤ 40 |
| `cb_person_default_on_file` | `Y` or `N` |
| `cb_person_cred_hist_length` | integer, 0–60 |

Categories are now exact matches. Before, `"rent"` (lowercase) was accepted. The model's
`OneHotEncoder(handle_unknown="ignore")` turned it into "no category" and returned a
plausible-looking but wrong score.

### `static/script.js`: frontend

| Where | What changed | Why |
|---|---|---|
| [static/script.js:198](static/script.js#L198) | `buildPayload()` no longer sends `loan_percent_income`. | The server computes it now, and would reject it with 422 because of `extra="forbid"`. The ratio bar in the form still works; it is display-only. |
| [static/script.js:288-290](static/script.js#L288-L290) | Added `REQUEST_TIMEOUT_MS` (60 s), `SLOW_HINT_MS` (5 s) and an `inFlight` flag. | Settings for the submit fixes below. |
| [static/script.js:293-309](static/script.js#L293-L309) | New `describeError()` turns FastAPI error bodies (422 `detail` lists) into readable text, e.g. `loan_grade: Input should be 'A', …`. | Before, every error said "server may be waking up", even validation errors. |
| [static/script.js:313](static/script.js#L313) | Submit handler returns early while a request is in flight. Button gets `disabled = true`. | Before, pressing Enter in a field sent duplicate requests. The CSS `pointer-events: none` only blocked mouse clicks. |
| [static/script.js:330-332](static/script.js#L330-L332) | `AbortController` cancels the request after 60 s. After 5 s the button reads "Waking up the server…". | Render free-tier cold starts could leave the spinner running indefinitely with no explanation. |
| [static/script.js:341-357](static/script.js#L341-L357) | Separate messages for validation errors (422), other server errors, timeouts and network failures. | Users see what actually went wrong. |
| [static/script.js:358-365](static/script.js#L358-L365) | `finally` clears both timers and re-enables the button. | Clean reset after every outcome. |

### `static/style.css`

| Where | What changed | Why |
|---|---|---|
| [static/style.css:601](static/style.css#L601) | `.primary:disabled { cursor: progress; }` | Visual cue now that the button is really disabled during a request. |

### Breaking change for API clients

Any client that sends `loan_percent_income` in `POST /predict` now gets **422 "Extra inputs are
not permitted"**. Remove the field from the request; the server calculates it. The response
format is unchanged.

### Verified

Tested with FastAPI `TestClient` against the real model:

- Valid request: 200, probability 0.0481. Same as before the change, so the server-side
  ratio matches what the frontend used to send.
- Rejected with 422: negative age, zero income, lowercase `rent`, grade `Z`, a client-sent
  `loan_percent_income`, employment length longer than possible for the age, loan amount
  over 35,000, and a missing field.
- `node --check static/script.js` passes.

Not done in this step: automated tests in the repo (step 2), and the browser UI was not
clicked through manually.

### Known issue left for later

The "Risky" preset returns a probability of exactly 1.0. That comes from the isotonic
calibration in the model, not from these changes. It's fixed in step 4 (retraining).
