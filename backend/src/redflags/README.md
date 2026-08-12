# Red-flag rules engine

Deterministic escalation triggers for adult acute cough / sore throat / URTI.
Rules run **before** the model and their hits are authoritative — the LLM may
add candidates for doctor review but may never suppress or downgrade a rule hit.

Planned: a versioned trigger list (id, label, severity, matcher, clinical source)
evaluated against the transcript, emitting `RedFlag` with `source: 'rule'`.
