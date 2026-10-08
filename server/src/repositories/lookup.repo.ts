import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../db/pool.js';

export interface LookupItem {
  id: number;
  name: string;
}

export interface CodedLookupItem extends LookupItem {
  code: string;
}

export interface SluggedLookupItem extends LookupItem {
  slug: string;
}

export interface Lookups {
  regions: CodedLookupItem[];
  languages: CodedLookupItem[];
  platforms: SluggedLookupItem[];
  tags: SluggedLookupItem[];
}

interface LookupRow extends RowDataPacket {
  id: number;
  name: string;
}

interface CodedLookupRow extends LookupRow {
  code: string;
}

interface SluggedLookupRow extends LookupRow {
  slug: string;
}

export async function getLookups(): Promise<Lookups> {
  const [regions] = await pool.query<CodedLookupRow[]>(
    `SELECT region_id AS id, name, code
       FROM region
      ORDER BY name ASC`,
  );

  const [languages] = await pool.query<CodedLookupRow[]>(
    `SELECT language_id AS id, name, iso_code AS code
       FROM \`language\`
      ORDER BY name ASC`,
  );

  const [platforms] = await pool.query<SluggedLookupRow[]>(
    `SELECT platform_id AS id, name, slug
       FROM platform
      ORDER BY name ASC`,
  );

  const [tags] = await pool.query<SluggedLookupRow[]>(
    `SELECT tag_id AS id, name, slug
       FROM playstyle_tag
      ORDER BY name ASC`,
  );

  return {
    regions: regions.map(({ id, name, code }) => ({ id, name, code })),
    languages: languages.map(({ id, name, code }) => ({ id, name, code })),
    platforms: platforms.map(({ id, name, slug }) => ({ id, name, slug })),
    tags: tags.map(({ id, name, slug }) => ({ id, name, slug })),
  };
}
