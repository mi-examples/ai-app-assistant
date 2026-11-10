/**
 * MI's internal Concierge sources (core ConciergeSettingsModel::INTERNAL_SOURCE_FIELD_MAP).
 * External connectors (Snowflake, Databricks, Fabric…) are left out by default: offered with a page
 * question, Concierge can route it to an unrelated agent.
 */
export const DEFAULT_SOURCES: readonly string[] = ['search', 'docs', 'faq', 'glossary'];

/** The instance's available sources that the app allows, in the instance's order. */
export function pickSources(available: string[], allowed: readonly string[] = DEFAULT_SOURCES): string[] {
  return available.filter((name) => allowed.includes(name));
}
