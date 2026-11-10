import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCES, pickSources } from './sources';

describe('pickSources', () => {
  const available = ['Snowflake', 'databricks', 'Fabric Data Agent', 'search', 'docs'];

  it('defaults to MI internal sources only', () => {
    expect(DEFAULT_SOURCES).toEqual(['search', 'docs', 'faq', 'glossary']);
    expect(pickSources(available)).toEqual(['search', 'docs']);
  });

  it('keeps the order the instance returns', () => {
    expect(pickSources(['glossary', 'docs', 'faq', 'search'])).toEqual(['glossary', 'docs', 'faq', 'search']);
  });

  it('an app can opt into external sources by name', () => {
    expect(pickSources(available, [...DEFAULT_SOURCES, 'Snowflake'])).toEqual(['Snowflake', 'search', 'docs']);
  });

  it('never adds a source the instance did not offer', () => {
    expect(pickSources(['search'], ['search', 'docs'])).toEqual(['search']);
  });

  it('returns empty when nothing allowed is available', () => {
    expect(pickSources(['Snowflake'])).toEqual([]);
  });
});
