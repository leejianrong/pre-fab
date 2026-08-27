import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "@prefab/api-client";
import type { Command } from "../registry.js";

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export interface AssetUploadArgs {
  siteId: string;
  filePath: string;
}

/**
 * Reads a local file and uploads it exactly the way the editor's (future)
 * upload widget and an MCP-driven agent both would — through the same
 * JSON+base64 body every surface sends (see apps/api/src/app.ts's
 * asset.upload handler for why JSON+base64 rather than multipart).
 */
export const assetUpload: Command<AssetUploadArgs, Asset> = {
  name: "asset.upload",
  mutation: "asset.upload",
  description: "Upload a local file as a site asset (content-addressed by sha256)",
  async run(ctx, args) {
    const bytes = await readFile(args.filePath);
    return ctx.api.uploadAsset(args.siteId, {
      filename: path.basename(args.filePath),
      contentType: contentTypeFor(args.filePath),
      dataBase64: bytes.toString("base64"),
    });
  },
};

export const assetList: Command<{ siteId: string }, Asset[]> = {
  name: "asset.list",
  description: "List a site's uploaded assets",
  run: (ctx, args) => ctx.api.listAssets(args.siteId),
};
