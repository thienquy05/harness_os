CREATE TABLE constitution_versions (
    id SERIAL PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    description TEXT
);

CREATE TABLE constitution_rules (
    id SERIAL PRIMARY KEY,
    rule_id TEXT NOT NULL UNIQUE,
    version_id INTEGER NOT NULL REFERENCES constitution_versions(id),
    domain TEXT NOT NULL,
    text TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    -- Not in the plan's original §3.3 sketch; added because CONST-CORE-002 and
    -- §2.1 both require this to be queryable per-rule, not just present in
    -- markdown prose.
    enforcement TEXT NOT NULL CHECK (enforcement IN ('gate', 'review')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Forward pointer, populated via UPDATE when a rule is superseded by a
    -- newer one. This table is not subject to the append-only-by-role
    -- guarantee (only `decisions` and `config_checksums` are, per §2.1/§3.5),
    -- so an UPDATE grant on this table is intentional.
    superseded_by INTEGER REFERENCES constitution_rules(id)
);

CREATE INDEX idx_constitution_rules_domain ON constitution_rules(domain);
CREATE INDEX idx_constitution_rules_version ON constitution_rules(version_id);

GRANT SELECT, INSERT, UPDATE ON constitution_versions, constitution_rules TO harness_app;
