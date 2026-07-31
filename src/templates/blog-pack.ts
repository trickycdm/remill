/**
 * Back-compat re-export: the blog scaffold moved into the pack registry
 * (src/templates/packs.ts) when the installer machinery landed — packs are
 * discoverable and installable now (admin Marketplace, MCP `install_pack`,
 * REST `POST /api/packs/:key/install`), so the standalone constant is no
 * longer the pack, just its data half.
 */

export { blogCollectionScaffold } from '@/templates/packs';
