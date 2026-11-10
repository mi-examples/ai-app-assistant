# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** in this repository.

Include the affected version, what an attacker could do, and steps to
reproduce. Leave out real tokens, customer data and internal hostnames.

## Supported versions

Only the latest release receives fixes.

## Scope

The package runs in the browser inside a Metric Insights portal page and
talks to that instance's Concierge and LLM proxy endpoints with the user's own
session. It stores no credentials. Guide files and page context are sent to
the model, so they must never contain secrets (see the README).

Vulnerabilities in the Metric Insights platform itself are out of scope here;
report them to Metric Insights support.
