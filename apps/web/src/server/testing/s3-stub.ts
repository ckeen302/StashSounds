/**
 * A tiny in-process S3 endpoint for unit tests: path-style buckets, PUT, HEAD, DELETE and the
 * multipart calls, kept in memory. It checks what the SDK and a browser actually send (methods,
 * paths, query strings, XML bodies and presigned expiry), so the storage code is tested over real
 * HTTP. It does not verify signatures or the signed length; the SeaweedFS suite does.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type StubRequest = { method: string; path: string; query: Record<string, string>; headers: Record<string, string | string[] | undefined> };

export class S3Stub {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  readonly requests: StubRequest[] = [];
  private server: Server | null = null;
  private nextId = 1;
  endpoint = "";

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(
        ({ status, headers = {}, body = "" }) => {
          res.writeHead(status, headers);
          res.end(body);
        },
        (e: unknown) => {
          res.writeHead(500);
          res.end(String(e));
        },
      );
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.endpoint = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers?: Record<string, string>; body?: string }> {
    const url = new URL(req.url ?? "/", this.endpoint);
    const query = Object.fromEntries(url.searchParams);
    const path = decodeURIComponent(url.pathname);
    this.requests.push({ method: req.method ?? "", path, query, headers: req.headers });
    const body = await readBody(req);
    const key = path.replace(/^\/+/, "");

    // Presigned requests: refuse an expired URL.
    if (query["X-Amz-Date"] && query["X-Amz-Expires"]) {
      const d = query["X-Amz-Date"];
      const signedAt = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));
      if (Date.now() > signedAt + Number(query["X-Amz-Expires"]) * 1000) return error(403, "AccessDenied", "Request has expired");
    }

    if (req.method === "PUT" && query.partNumber && query.uploadId) {
      const up = this.uploads.get(query.uploadId);
      if (!up || up.key !== key) return error(404, "NoSuchUpload", "no such upload");
      up.parts.set(Number(query.partNumber), body);
      return { status: 200, headers: { ETag: `"part-${query.partNumber}"` } };
    }
    if (req.method === "PUT") {
      this.objects.set(key, body);
      return { status: 200, headers: { ETag: '"object"' } };
    }
    if (req.method === "POST" && "uploads" in query) {
      const id = `upload-${this.nextId++}`;
      this.uploads.set(id, { key, parts: new Map() });
      const [bucket, ...rest] = key.split("/");
      return xml(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${rest.join("/")}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === "POST" && query.uploadId) {
      const up = this.uploads.get(query.uploadId);
      if (!up || up.key !== key) return error(404, "NoSuchUpload", "no such upload");
      const listed = [...body.toString("utf8").matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
        n: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1]!)?.[1]),
        etag: /<ETag>([^<]*)<\/ETag>/.exec(m[1]!)?.[1]?.replace(/&quot;/g, '"'),
      }));
      for (const p of listed) if (!up.parts.has(p.n) || p.etag !== `"part-${p.n}"`) return error(400, "InvalidPart", `part ${p.n}`);
      this.objects.set(key, Buffer.concat(listed.map((p) => up.parts.get(p.n)!)));
      this.uploads.delete(query.uploadId);
      return xml(`<CompleteMultipartUploadResult><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === "DELETE" && query.uploadId) {
      this.uploads.delete(query.uploadId);
      return { status: 204 };
    }
    if (req.method === "DELETE") {
      this.objects.delete(key);
      return { status: 204 };
    }
    if (req.method === "HEAD") {
      const o = this.objects.get(key);
      return o ? { status: 200, headers: { "Content-Length": String(o.length), ETag: '"object"' } } : { status: 404 };
    }
    return error(400, "NotImplemented", `${req.method} ${path}`);
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function xml(body: string) {
  return { status: 200, headers: { "Content-Type": "application/xml" }, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` };
}

function error(status: number, code: string, message: string) {
  return { status, headers: { "Content-Type": "application/xml" }, body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>` };
}
