# Master Office — Kiến trúc hệ thống

> Enterprise Productivity Suite lấy cảm hứng từ cấu trúc UX của Lark Suite và hệ sinh thái Microsoft 365.
> Không sao chép branding/logo/UI pixel-perfect. Tên sản phẩm: **Master Office**.

---

## 0. Nguyên tắc thiết kế

| # | Nguyên tắc | Hệ quả |
|---|-----------|--------|
| P1 | **Một object model cho mọi thứ** (`resource`) | Drive, Chat, Search, AI, Permission đều nói chuyện bằng `resource_id`. Chat không bao giờ copy file. |
| P2 | **Internal model ≠ file format** | Editor chỉnh sửa JSON + CRDT (Yjs). DOCX/XLSX/PPTX chỉ xuất hiện ở biên (import/export). |
| P3 | **Modular monolith trước, microservice sau** | Backend NestJS chia module theo bounded context, giao tiếp qua interface + event. Tách service khi có lý do đo được. |
| P4 | **Event-driven qua Transactional Outbox** | Mọi thay đổi resource ghi event trong cùng transaction → Redis Streams → indexer, notifier, AI embedder, audit. |
| P5 | **Permission-aware ở mọi tầng** | Search, AI (RAG), link preview trong chat đều lọc theo quyền của người xem. |
| P6 | **Interoperability là tính năng hạng nhất** | Mỗi lần import sinh ra *Fidelity Report* nói rõ cái gì giữ được, cái gì không. |
| P7 | **Desktop-first application shell** | Không có landing page. App mở ra là workspace. |

---

## 1. System context

```
                         ┌─────────────────────────────────────────────┐
  Browser / Desktop ────►│  apps/web  (Next.js, React, Tailwind, Radix)│
  (Electron/Tauri sau)   │  App Shell · Editors · y-indexeddb offline  │
                         └───────┬───────────────┬──────────────┬──────┘
                        HTTPS/REST│      WSS (Yjs)│     WSS (events)
                                 ▼               ▼              ▼
                ┌────────────────────┐ ┌──────────────────┐ ┌──────────────────┐
                │ apps/api (NestJS)  │ │ apps/collab      │ │ api: Realtime    │
                │ modular monolith   │ │ Hocuspocus (Yjs) │ │ Gateway (chat,   │
                │                    │ │ auth → api       │ │ presence, notif) │
                └──┬───┬───┬───┬─────┘ └──────┬───────────┘ └───────┬──────────┘
                   │   │   │   │              │                      │
          ┌────────┘   │   │   └────────┐     │                      │
          ▼            ▼   ▼            ▼     ▼                      ▼
     PostgreSQL     Redis (cache,     S3/MinIO          Redis Pub/Sub (fan-out)
     (source of     Streams, locks)   (blobs, snapshots,
      truth)             │             exports)
                         ▼
     ┌─────────────── Workers (consume Redis Streams) ────────────────┐
     │ converter (DOCX/XLSX/PPTX/PDF, LibreOffice, Chromium)          │
     │ indexer  (OpenSearch)   embedder (vector)   notifier   audit   │
     │ ai-runner (agent tool loop)                                     │
     └─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
                    OpenSearch (full-text + k-NN)
                         │
             Microsoft Graph API (OneDrive / SharePoint / Outlook) — optional connector
```

---

## 2. Monorepo layout

```
office/
├─ apps/
│  ├─ web/            Next.js App Router — shell + tất cả app UI
│  ├─ api/            NestJS — REST + WS gateway, modular monolith
│  ├─ collab/         Hocuspocus server — Yjs sync, persistence, awareness
│  └─ worker/         (Phase 2+) conversion / indexing / AI workers
├─ packages/
│  ├─ shared/         Types + zod schemas dùng chung FE/BE (Resource, Role, Events…)
│  ├─ doc-model/      (Phase 2) Tiptap schema ⇄ JSON ⇄ Yjs
│  ├─ sheet-model/    (Phase 3) Workbook model + Yjs binding
│  ├─ slide-model/    (Phase 4) Presentation element tree + Yjs binding
│  └─ convert/        (Phase 2+) DOCX/XLSX/PPTX/PDF converters
├─ infra/
│  └─ docker-compose.yml  Postgres, Redis, S3 (SeaweedFS ở dev), OpenSearch
└─ docs/
```

Tool: **pnpm workspaces**, TypeScript toàn stack (chia sẻ type FE/BE là lý do chính chọn NestJS thay vì Go; Go vẫn là lựa chọn cho converter/search worker hiệu năng cao sau này).

---

## 3. Frontend architecture

### 3.1 Layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Logo Master Office │   🔍 Search across Master Office (Ctrl K)   │ +New ? ⚙ 🔔 👤 │
├────────────┬───────────────┬─────────────────────────────────┬────────────────┤
│ App        │ Space / App   │  Main workspace                 │ Details panel  │
│ sidebar    │ navigation    │  (chiếm phần lớn màn hình)      │ (đóng/mở)      │
│ 232px      │ 232px         │                                 │ 330px          │
│ (72px thu  │ (Drive, Space)│                                 │                │
│ gọn): Apps │               │                                 │                │
│ Favorites  │               │                                 │                │
│ Spaces     │               │                                 │                │
└────────────┴───────────────┴─────────────────────────────────┴────────────────┘
```

- `app/(shell)/layout.tsx` render App Sidebar + Top Bar **một lần** → giữ nguyên khi chuyển app (không remount).
- Mỗi app là một route segment: `/home`, `/chat`, `/drive`, `/docs/[id]`, `/sheets/[id]`, `/slides/[id]`, `/spaces/[spaceId]`, `/base/[id]`, …
- **App Registry** (`lib/apps.ts`): khai báo id, label, icon, route, `resourceTypes` mà app đó mở được. Đây là nơi “open with đúng editor” được resolve:

```ts
openResource(r) → registry.find(app => app.opens.includes(r.type)).route(r.id)
// document → /docs/:id, spreadsheet → /sheets/:id, presentation → /slides/:id,
// pdf/image/video → /drive/preview/:id, folder → /drive/folder/:id, base → /base/:id …
```

### 3.2 State & data
- **Server state**: TanStack Query, key theo `resource_id`. Mọi app dùng chung cache resource → đổi tên trong Drive cập nhật ngay trong Chat card.
- **Realtime state**: Yjs documents (editor) + WS gateway events (chat, notification, presence) → invalidate Query cache.
- **UI state**: Zustand nhỏ (panel mở/đóng, view mode) persist localStorage.
- **Offline**: `y-indexeddb` cho editor; outbox local cho chat message chưa gửi.

### 3.3 Design system (theo bộ nhận diện Master Office — `logo.png` và các ảnh giao diện tham chiếu)
- **Màu**: Primary Blue `#2563EB`, Primary Purple `#8B5CF6`, Accent Blue `#38BDF8`, Dark `#0F172A`, Gray `#94A3B8`, nền `#F5F7FB`/`#F8FAFC`. Token nằm trong `apps/web/src/app/globals.css` (`@theme` của Tailwind 4).
- **Logo**: chữ M dạng dải lụa gradient xanh → tím (`LogoMark`, `public/icon.svg`). Slogan: *Work together, go further*.
- **App icon**: squircle gradient + icon trắng (`AppIcon`); màu từng app theo "App icon set", khai báo trong `lib/apps.tsx`.
- **File icon**: ô vuông màu theo loại (Docs xanh, Sheets xanh lá, Slides cam, PDF đỏ, folder vàng) — `lib/resources.tsx`.
- Radius card 12px, control 8px; font Inter (có subset tiếng Việt); row bảng 44px (compact 36px); chữ 13–14px.
- Radix primitives (Dialog, DropdownMenu, ContextMenu, Tooltip, Tabs), `cmdk` cho command palette, `lucide-react` icons, `sonner` cho toast.
- Quy ước tương tác: menu mở dialog không trả focus về trigger (`onCloseAutoFocus`); dialog focus ô nhập đầu tiên. Phím tắt Drive: Enter mở, F2 đổi tên, Delete bỏ vào thùng rác, Ctrl+A chọn tất cả, Shift/Ctrl-click chọn nhiều.

---

## 4. Backend — bounded contexts (NestJS modules)

| Module | Trách nhiệm | Bảng chính |
|---|---|---|
| `identity` | user, session, SSO (OIDC/SAML sau), API token | `users`, `sessions` |
| `org` | organization, workspace, department, contacts | `organizations`, `workspaces`, `org_members` |
| `spaces` | Space, membership, role | `spaces`, `space_members` |
| `resources` | **Unified Resource** CRUD, tree, trash, star, recent, versions | `resources`, `resource_versions`, `stars`, `resource_access_log` |
| `permissions` | ACL, role resolution, share link | `acl_entries`, `share_links` |
| `storage` | blob upload/download, presigned URL, content-addressed | `blobs` |
| `collab` (bridge) | auth token cho Hocuspocus, snapshot/versions | `ydoc_updates`, `ydoc_snapshots` |
| `convert` | job import/export, fidelity report | `conversion_jobs` |
| `chat` | conversation, message, reaction, thread, resource card | `conversations`, `messages`, `message_refs` |
| `calendar` / `meetings` | event, RSVP, meeting room, recording → resource | `events`, `attendees` |
| `tasks` | task, tasklist, assignee | `tasks` |
| `base` | database table/field/record/view | `bases`, `base_tables`, `base_records` (JSONB) |
| `wiki` | wiki tree (resource type `wiki`) | (dùng `resources` + Yjs) |
| `approvals` | workflow definition + instance | `approval_flows`, `approval_instances` |
| `flow` | sơ đồ / workflow designer (flowchart, BPMN, UI blocks); có thể gắn trigger để chạy như approval | `resources` (type `diagram`) + Yjs shape graph |
| `projects` / `analytics` | project gom task; dashboard hiệu suất (completion rate, on-time, cycle time, workload) | `projects`, materialized views |
| `mail` | IMAP/Graph connector (sau) | — |
| `search` | query API → OpenSearch, permission filter | — |
| `notifications` | inbox, push | `notifications` |
| `ai` | agent orchestrator, tools, RAG | `ai_threads` |
| `audit` | append-only audit log | `audit_events` |
| `events` | outbox publisher | `outbox` |

---

## 5. Unified Resource Model

### 5.1 Bảng `resources`

```sql
CREATE TYPE resource_type AS ENUM
 ('folder','document','spreadsheet','presentation','pdf','image','video',
  'file','base','wiki','form','shortcut');

CREATE TABLE resources (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  space_id       uuid NULL REFERENCES spaces(id),      -- NULL = "My Files" của owner
  parent_id      uuid NULL REFERENCES resources(id),   -- folder cha
  name           text NOT NULL,
  type           resource_type NOT NULL,
  owner_id       uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        bigint NOT NULL DEFAULT 1,            -- optimistic concurrency cho metadata
  size_bytes     bigint NOT NULL DEFAULT 0,
  mime_type      text,
  blob_id        uuid NULL REFERENCES blobs(id),       -- file nhị phân (pdf/image/video/file)
  content_ref    text NULL,                            -- ydoc name cho document/sheet/slide/wiki
  link_target_id uuid NULL REFERENCES resources(id),   -- shortcut
  general_access text NOT NULL DEFAULT 'restricted',   -- restricted | workspace | anyone_with_link
  general_role   text NULL,                            -- role cho general_access
  description    text,
  tags           text[] NOT NULL DEFAULT '{}',
  metadata       jsonb NOT NULL DEFAULT '{}',          -- type-specific: page_count, sheet_names, import fidelity…
  trashed_at     timestamptz NULL,
  trashed_by     uuid NULL,
  path           uuid[] NOT NULL DEFAULT '{}'          -- materialized ancestors, cho breadcrumb & quyền kế thừa
);
CREATE INDEX ON resources (workspace_id, parent_id) WHERE trashed_at IS NULL;
CREATE INDEX ON resources USING gin (path);
```

**Một file = một hàng logic.** Chat/Task/Calendar/Wiki tham chiếu bằng `resource_id` (bảng `message_refs(message_id, resource_id)`), không bao giờ nhân bản blob.

### 5.2 Content storage theo type

| type | Nội dung sống ở đâu | Snapshot/export |
|---|---|---|
| document, wiki | Yjs doc `res:<id>` (Hocuspocus) | JSON snapshot (ProseMirror JSON) trong S3 |
| spreadsheet | Yjs doc `res:<id>` (workbook binding) | Workbook JSON |
| presentation | Yjs doc `res:<id>` (element tree) | Presentation JSON |
| base | Postgres (`base_records` JSONB), realtime qua WS gateway | CSV/XLSX export |
| pdf, image, video, file | `blobs` → S3 key `blobs/<sha256>` (content-addressed, dedupe) | file gốc |
| folder, shortcut | chỉ metadata | — |

### 5.3 Versioning
- **Metadata**: cột `version` (optimistic lock, `If-Match`).
- **Collaborative content**: Yjs updates append → compaction thành snapshot mỗi N updates / T phút. *Version history* = danh sách snapshot (`resource_versions`: id, resource_id, created_by, label, snapshot_key, created_at). Restore = áp snapshot như một update mới (không phá lịch sử).
- **Binary files**: upload phiên bản mới → hàng mới `resource_versions` trỏ blob mới.

---

## 6. Permission model

### 6.1 Roles (thứ tự tăng dần)

```
viewer < commenter < editor < admin < owner
```

| Capability | viewer | commenter | editor | admin | owner |
|---|:-:|:-:|:-:|:-:|:-:|
| view / download* | ✓ | ✓ | ✓ | ✓ | ✓ |
| comment | | ✓ | ✓ | ✓ | ✓ |
| edit content, create child | | | ✓ | ✓ | ✓ |
| share, manage members | | | | ✓ | ✓ |
| delete permanently, transfer ownership | | | | | ✓ |

\* download có thể bị tắt bằng policy.

### 6.2 Principal & ACL
`acl_entries(resource_id | space_id, principal_type: user|group|department|workspace, principal_id, role, inherited:boolean)`

### 6.3 Thuật toán resolve (effective role)
```
effectiveRole(user, resource) = max(
   owner nếu resource.owner_id = user,
   ACL trực tiếp trên resource,
   ACL trên mọi ancestor trong resource.path (kế thừa xuống),
   space_members role nếu resource.space_id,
   general_access (workspace / anyone_with_link) → general_role
)
```
Cache ở Redis: `perm:<user>:<resource>` TTL ngắn, invalidate bằng event `acl.changed` (+ path prefix).

### 6.4 Chia sẻ qua Chat
Gửi resource vào chat → nếu người nhận không có quyền, UI hỏi người gửi: *“Cấp quyền Viewer/Editor cho N thành viên?”* → tạo ACL entry. Không tạo bản sao.

---

## 7. Internal content models

### 7.1 Document (Tiptap / ProseMirror)
- Schema ProseMirror: `doc > block+`; block: paragraph, heading(1-6), bulletList, orderedList, taskList, blockquote, codeBlock, horizontalRule, table, image, mention, callout. Marks: bold, italic, underline, strike, code, link, textStyle(fontFamily, fontSize, color), highlight, comment(id), suggestion(insert/delete, author).
- Yjs: `Y.XmlFragment('content')` qua `y-prosemirror` (Tiptap Collaboration extension). Comments: `Y.Map('comments')` (thread, anchor bằng Yjs RelativePosition).
- Autosave là mặc định (CRDT); “Saved” = update đã được server ack.

### 7.2 Spreadsheet (Univer)
Univer là UI + formula engine. **Lưu ý license**: collaboration, import/export XLSX của Univer nằm ở bản Pro/Server. Vì vậy:
- **Model của chúng ta** (Yjs):
  ```
  Y.Map('workbook') { id, name, sheetOrder: Y.Array<sheetId>, styles: Y.Map<styleId, Style> }
  Y.Map('sheets') → sheetId → Y.Map {
     name, rowCount, colCount, frozen, merges: Y.Array, colWidths: Y.Map, rowHeights: Y.Map,
     cells: Y.Map<"r:c", {v, f?, s?, t?}>,    // value, formula, styleId, type
     validations, conditionalFormats, filters, charts, pivots }
  ```
- **Binding** Yjs ⇄ Univer: lắng nghe `onCommandExecuted` (mutations) → ghi Y.Map; observe Y.Map từ remote → `executeCommand` mutation với flag `fromCollab` để tránh vòng lặp. Cells keyed `r:c` cho conflict ở mức ô (last-writer-wins per cell là hành vi mong muốn của spreadsheet). Insert/delete row/col cần **stable row/col IDs** (`rowOrder: Y.Array<rowId>`) để không lệch địa chỉ khi đồng thời chèn dòng — đây là quyết định quan trọng nhất của Sheets, làm từ đầu.
- Formula engine: dùng engine open-source của Univer ở client; server-side tính lại khi export/AI bằng cùng engine (Node) để giá trị cache trong XLSX đúng.

### 7.3 Presentation
Editor tự xây (React + SVG/DOM canvas, không phụ thuộc thư viện đóng):
```
Y.Map('deck') { size: {w:1280,h:720}, themeId, masters, layouts }
Y.Array('slideOrder') <slideId>
Y.Map('slides') → slideId → Y.Map { layoutId, background, notes: Y.Text,
     elements: Y.Map<elId, Y.Map{ type: text|shape|image|video|icon|table|chart|diagram,
                                   x,y,w,h,rotation,z, style, content } > }
```
Text element dùng `Y.XmlFragment` (cùng schema rút gọn với Docs) để có rich-text collaborative.

---

## 8. Conversion layer (File interoperability)

```
                 Import                                   Export
.doc/.xls/.ppt ─► LibreOffice headless ─► .docx/.xlsx/.pptx
.docx ─► OOXML parser (JSZip + XML) ─► ProseMirror JSON ─► Y.Doc      Y.Doc ─► JSON ─► `docx` lib ─► .docx
.xlsx ─► ExcelJS ─► Workbook JSON ─► Y.Doc                            Y.Doc ─► JSON ─► ExcelJS ─► .xlsx / .csv
.csv  ─► papaparse ─► Workbook JSON                                   Y.Doc ─► JSON ─► pptxgenjs ─► .pptx
.pptx ─► OOXML parser ─► Presentation JSON ─► Y.Doc                   any ─► HTML render ─► Chromium ─► .pdf / .png
```

- Chạy trong **worker** (`convert` queue), job lưu trạng thái trong `conversion_jobs`; UI hiển thị tiến độ qua WS.
- **Fidelity Report** (lưu vào `resources.metadata.import`):
  ```json
  { "source": "report.xlsx", "preserved": ["formulas","styles","merges","charts:3"],
    "degraded": ["pivot:1 → static values"], "dropped": ["vbaProject.bin","externalLinks"] }
  ```
  → hiển thị banner “Một số tính năng không được hỗ trợ” trong editor.
- **Preserve unknown parts**: phần OOXML không hiểu (custom XML, một số extension) lưu lại dưới `metadata.ooxmlPassthrough` (blob) và chèn lại khi export nếu an toàn.
- File gốc upload luôn được giữ làm **version 0** → người dùng luôn tải lại được bản gốc.
- Không hứa hỗ trợ: VBA/macro, Power Query, external data connections, Office Add-ins, animation phức tạp, SmartArt đặc thù, track changes phức tạp. Font thiếu → fallback + cảnh báo; font server-side đóng gói bộ font phổ biến (Noto, Carlito≈Calibri, Caladea≈Cambria, Liberation).

---

## 9. Realtime collaboration

- **Hocuspocus** (Yjs WebSocket server) ở `apps/collab`, document name = `res:<resource_id>`.
- `onAuthenticate`: nhận JWT ngắn hạn từ api (`POST /collab/token`) chứa `{user, resource, role}`; role < editor → connection read-only; commenter chỉ được sửa `comments` map.
- **Persistence**: `onStoreDocument` (debounce 2s) → ghi incremental update vào `ydoc_updates`; compaction worker gộp thành snapshot S3. Redis extension của Hocuspocus để scale ngang nhiều node.
- **Awareness**: cursor, selection, màu, tên → hiển thị avatar online trên header editor.
- **Offline**: `y-indexeddb` + reconnect tự merge (CRDT đảm bảo hội tụ).
- Sau mỗi snapshot → event `resource.content_changed` → indexer, embedder, thumbnail.

---

## 10. Chat integration

- `messages(id, conversation_id, sender_id, body (rich JSON), created_at, thread_root_id, edited_at)`
- `message_refs(message_id, ref_type: resource|task|event|base_record, ref_id)`
- Render: **Resource Card** — lấy metadata live từ resource cache (tên, icon theo type, owner, thumbnail) → click → `openResource()` → đúng editor.
- Kéo file từ máy vào chat = upload vào Drive (folder “Chat files” của conversation, hoặc Space tương ứng) → message chỉ giữ `resource_id`.
- Realtime: WS gateway (Socket.IO) + Redis adapter; typing, read receipts.

---

## 11. Search

- Index OpenSearch `resources`, `messages`, `people`, `events`, `tasks`, `base_records`, mỗi doc có `acl_principals: [user:x, group:y, workspace:z, space:s]`.
- Query: expand principal set của user → `terms` filter. Sau đó re-check quyền cho top N (defense in depth).
- Command palette (⌘K) = search + actions (“New document”, “Go to Drive”).

---

## 12. AI layer

- `ai` module = **agent orchestrator** gọi Claude (mặc định `claude-opus-5-5` cho tác vụ phức tạp, `claude-haiku-4-5-20251001` cho tóm tắt nhanh) với tool-use.
- **Runtime đề xuất: `cdfl_harness` (D:\harness) chạy dạng sidecar** (`ruby -Ilib sidecar.rb`, chỉ bind 127.0.0.1). Harness đã có sẵn đúng các thứ lớp AI cần: gateway nhiều provider (Anthropic / OpenAI / Ollama) + PII redaction + audit hash + structured output có 1 vòng sửa; vòng PLAN → EXECUTE → CRITIC có ngân sách token; tool registry lấy danh tính từ Context (không bao giờ từ tham số LLM); grounding gate "không đủ bằng chứng thì từ chối".
  ```
  Web ──► api/ai (NestJS) ──POST /session/run {workflow_id, input, context{tenant_id=workspace, user_id, role}, tool_token}──► harness sidecar :4477
                  ▲                                                                                              │ tool call
                  └──── /ai-tools/* (search_workspace, read_resource, query_sheet, create_document, …) ◄──────────┘
                        xác thực bằng tool_token (HMAC ngắn hạn, như collab token) → chạy dưới quyền của user
  ```
  Master Office vẫn là nơi duy nhất quyết định quyền: tool của harness chỉ gọi lại API `/ai-tools/*` bằng token ủy quyền, nên AI không bao giờ đọc được thứ user không được xem. Việc cần làm phía harness (repo riêng): thêm workflow + tool của Master Office và route sidecar tương ứng.
- Tools (mỗi tool chạy **dưới danh nghĩa user**, qua cùng permission service):
  `search_workspace`, `read_resource`, `query_sheet(range)`, `run_formula`, `query_base`, `summarize_chat`, `create_document`, `create_presentation`, `create_chart`, `create_task`, `list_meetings`.
- RAG: embedder worker chunk nội dung (theo heading/sheet/slide) → vector trong OpenSearch k-NN với cùng `acl_principals`.
- Ví dụ *“Phân tích doanh thu tháng 9 và làm slide báo cáo”*:
  `search_workspace("doanh thu tháng 9", type=spreadsheet)` → `query_sheet` → phân tích → `create_chart` → `create_document(report)` → `create_presentation(slides từ outline + chart)` → trả về card các resource mới.
- Mọi thay đổi do AI tạo có `updated_by = user`, `metadata.ai_generated = true`, và được ghi audit.

---

## 13. Events (outbox)

```
resource.created | resource.updated | resource.moved | resource.trashed | resource.restored
resource.content_changed | acl.changed | message.created | task.updated | event.updated
conversion.completed | conversion.failed
```
Ghi vào bảng `outbox` trong cùng transaction → publisher đẩy sang Redis Streams (Kafka khi scale) → consumer groups: `indexer`, `notifier`, `embedder`, `audit`, `thumbnailer`.

---

## 14. Microsoft 365 integration (connector, Phase 7)
- OAuth với Microsoft Entra ID, Microsoft Graph: OneDrive/SharePoint drive items xuất hiện như **external resource** (`type` giữ nguyên, `metadata.external = {provider:'m365', driveId, itemId, eTag}`).
- Mở: tải về → import → chỉnh sửa trong editor native → “Sync back” export OOXML → PUT lên Graph với `If-Match: eTag` (conflict → tạo bản copy).
- Outlook mail/calendar qua Graph cho module Mail/Calendar.

---

## 15. Infrastructure
- Dev: `infra/docker-compose.yml` — Postgres 16, Redis 7, MinIO, OpenSearch 2.
- Prod: Kubernetes; api/collab/worker scale ngang; Hocuspocus sticky theo document name (Redis extension); S3; managed Postgres (read replica cho search indexing); CDN cho static & thumbnail.
- Observability: OpenTelemetry → traces qua api ⇄ worker ⇄ collab.

---

## 16. Lộ trình triển khai

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **1** | Monorepo, infra, App Shell (sidebar, top bar, command palette), Unified Resource Model, Spaces, Drive (CRUD, upload/download S3, trash, star, recent, details panel), khung editor | **xong** — xem §18 |
| **2** | Docs editor (Tiptap) + Hocuspocus + version history + comments + DOCX/PDF/HTML/TXT export, DOCX import | **xong** — xem §19 |
| **2b** | **Notes & Mind Map** (ảnh "takenote và sơ đồ tư duy"): ghi chú dùng Docs editor + heading gập được, task có người phụ trách/hạn chót, thuộc tính trang, tags, linked pages, backlinks, related files; Mind Map (canvas node-link, "Convert notes to mind map", chế độ Note / Mind Map / Both) | **xong** — xem §21 |
| **2.1** | Word parity: tìm/thay thế, thiết lập trang + print layout + print preview, header/footer + số trang, ngắt trang, mục lục, chế độ gợi ý sửa (xuất thành track changes của Word), chỉ số trên/dưới, giãn dòng, Title/Subtitle, đổi hoa-thường | **xong** — xem §20 |
| 2.2 | Phần Word còn lại theo `docs/OFFICE-PARITY.md` §1 (footnote, cột, style tổ chức, so sánh phiên bản, bộ đọc OOXML giữ font/màu, .doc qua LibreOffice) | |
| **3** | Sheets: Univer (ribbon kiểu Excel, công thức, filter, sort, conditional formatting, data validation, find & replace, hyperlink) + binding Yjs tự viết + XLSX/CSV/PDF/HTML import-export + phiên bản + bộ kiểm chứng công thức Excel | **xong** — xem §22 |
| **3.2** | **Tab sheet phía trên (kiểu Lark)** + **Macro**: ghi macro → JavaScript, trình soạn script, chạy bằng menu / Ctrl+Alt+Shift+1–9, sandbox Web Worker, API kiểu Apps Script; .xlsm giữ mã VBA (chỉ đọc) | **xong** — xem §24 |
| 3.1 | Chart, pivot, comment theo ô, con trỏ người khác trên lưới, xuất CF/validation/filter ra XLSX, import CF/validation từ XLSX, ảnh trong ô, .xls/.ods qua LibreOffice | |
| **4** | Slides editor (canvas element tree + Yjs), theme/layout/background, bảng, biểu đồ (liên kết Sheets), comment theo đối tượng, speaker notes, slide sorter, trình chiếu + presenter view, PPTX import/export, PDF/PNG/HTML | **xong** — xem §23 |
| 4.1 | Animation, nhóm đối tượng (group), section, crop ảnh, video, SmartArt → diagram, .ppt/.odp qua LibreOffice | |
| **8** | **Forms** (kéo lên trước Phase 5 theo lộ trình Google parity): trình soạn cộng tác, 12 loại câu hỏi + tiêu đề/ảnh/video/section, rẽ nhánh, kiểm tra hợp lệ, quiz, cài đặt, trang trả lời `/f/:id`, tab Responses (tóm tắt / theo câu / từng người), liên kết Sheets, CSV | **xong** — xem §25 |
| **5** | Chat (conversation, message, resource card, WS) + Notifications | **xong** — chat & realtime §64, file & ghim §65, thông báo §66, Contacts & hồ sơ §67 |
| 6 | Search (OpenSearch, outbox, indexer) + AI layer | |
| 7 | Calendar, Meetings, Tasks (Board/List/Timeline/Gantt/Dashboard), Flow designer, Base, Approvals, Contacts, Admin, Analytics, M365 connector | đang làm — Calendar §71, Tasks §72, Meetings §73, Approvals §74, Base §75 xong, Tasks kiểu Jira §76 xong, Flow §77 (đợt 1 xong) (Contacts §67 xong ở Phase 5) |

---

## 17. Rủi ro chính & quyết định

| Rủi ro | Giảm thiểu |
|---|---|
| Univer collaboration/XLSX là tính năng Pro | Tự viết Yjs binding + ExcelJS converter; đánh giá mua license nếu thời gian quan trọng hơn chi phí |
| Row/col insert đồng thời làm lệch ô | Stable row/col IDs ngay từ model đầu tiên |
| Fidelity OOXML | Giữ file gốc làm version 0, fidelity report, test corpus file Office thật trong CI (round-trip + mở bằng LibreOffice để validate) |
| Permission leak qua search/AI | ACL principals trong index + re-check trước khi trả kết quả / đưa vào prompt |
| Yjs doc lớn (sheet hàng trăm nghìn ô) | Chunk sheet thành nhiều subdoc theo block 1000 dòng, lazy load |

---

## 18. Phase 1 — hiện trạng & quyết định phát sinh

**Đã chạy được**
- API (`apps/api`): resources (list theo view / folder / space / type, get + breadcrumb, create, rename / move / tags / description với `If-Match`, deep copy, trash / restore / xóa vĩnh viễn, star, recent), upload / download (content-addressed, giữ tên tiếng Việt), ACL + chia sẻ, space + thành viên, activity (audit), stats, search (Postgres ILIKE + lọc quyền). Mọi thay đổi ghi `audit_events` + `outbox` trong cùng transaction.
- Web (`apps/web`): Home, Drive (4 kiểu xem, tab loại file, context menu, kéo-thả upload, chọn nhiều, details panel, dialog Share / Move / Rename / Delete), Spaces (lưới + trang tổng quan 7 tab), trang Docs / Sheets / Slides / Wiki (danh sách + khung editor), xem trước PDF / ảnh / video / text, command palette, đổi user (dev).
- Test: `pnpm test` = smoke API (27 kiểm tra quyền / di chuyển / thùng rác…) + e2e Playwright (11 bước UI).

**Quyết định phát sinh**

| Vấn đề | Quyết định |
|---|---|
| Image `minio/minio` không còn phát hành công khai | Dev dùng SeaweedFS (S3 API). Code chỉ dùng S3 SDK → prod dùng AWS S3 / MinIO không đổi code. |
| Proxy rewrite của Next.js buffer body và cắt ở 10 MB | JSON đi qua `/api` (same-origin); **upload đi thẳng tới API origin** (CORS có credentials). Phase 2: presigned PUT lên S3 + endpoint xác nhận. |
| Ổ E: là exFAT (không có symlink) | pnpm `node-linker=hoisted`; `@workos/shared` dùng qua TS path alias (Nest CLI viết lại import khi build). |
| Transaction `pg` không cho query chồng nhau | `runAll(inTx, [...])`: song song trên pool, tuần tự trong transaction. |
| Chưa có identity | Header `x-user-id` hoặc cookie `mo_uid` (menu "Switch user (dev)"). Thay bằng OIDC session ở module `identity` — chỉ `CurrentUserMiddleware` thay đổi. |
| Timestamp Postgres không phải ISO | Custom column `isoTimestamp` trả ISO-8601 cho mọi bảng. |

---

## 19. Phase 2 — Docs: hiện trạng & quyết định

**Đã chạy được**
- `packages/doc-model`: schema Tiptap dùng chung trình duyệt ↔ server (callout, thẻ file Drive `resourceEmbed`, task có `assignee`/`due`), serializer HTML/TXT/outline.
- Realtime: Hocuspocus nhúng trong API (cổng 4001), token HMAC 10 phút mang quyền; viewer/commenter kết nối **read-only** (server từ chối update); Yjs state trong `ydoc_states`; lưu debounce 2 s / tối đa 10 s; `content_text` cho tìm kiếm; hoạt động "đã sửa" gộp 10 phút/người; snapshot tự động 15 phút lên S3.
- Web: editor Tiptap (font, cỡ, màu, highlight, căn lề, danh sách 3 loại, thụt lề, link, ảnh upload/dán/kéo-thả, bảng đầy đủ thao tác, code, quote, callout, divider, @mention, thẻ file), con trỏ người khác, người đang online, trạng thái lưu, cache IndexedDB offline, outline, comment (neo Yjs relative position, trả lời, resolve, đồng bộ qua stateless message), lịch sử phiên bản (lưu, xem trước, khôi phục), menu File/Edit/View/Insert/Format/Tools/Help có lệnh thật.
- Chuyển đổi: export DOCX (thư viện `docx`: heading, danh sách lồng + đánh số, checklist, bảng + gộp ô, ảnh, callout, màu/font/cỡ, link), PDF (Chromium), HTML, TXT; import DOCX (mammoth → schema) với báo cáo giữ định dạng; tải xuống tài liệu native = DOCX; "Make a copy" sao chép nội dung + ảnh.
- Test: `apps/api/test/docs.mjs` (27 kiểm tra: 2 client Yjs thật, read-only, lưu, comment, phiên bản, export/import round-trip) + `apps/web/e2e/docs-flow.mjs` (12 bước với 2 trình duyệt cùng lúc).

**Quyết định phát sinh**

| Vấn đề | Quyết định |
|---|---|
| Comment cần cả người chỉ có quyền comment | Comment nằm ở Postgres, **không** nằm trong Yjs; neo bằng Yjs RelativePosition nên bám đúng chữ khi người khác sửa. Thay đổi comment được phát qua stateless message của Hocuspocus. |
| Khôi phục phiên bản / import khi có người đang sửa | Ghi qua `openDirectConnection` của Hocuspocus như một transaction Yjs bình thường → mọi người thấy ngay, không ghi đè lén DB. Luôn lưu "Before restore" trước khi khôi phục. |
| Ảnh trong tài liệu | Blob content-addressed + bảng `resource_assets`; URL gắn với tài liệu nên ảnh theo đúng quyền của tài liệu; export chỉ nhúng ảnh đã đăng ký cho tài liệu đó. |
| Kiểu dữ liệu `@tiptap/html/server` với `moduleResolution: node` | Khai báo shim trong `apps/api/src/types.d.ts`; chạy thật dùng `exports` của Node. |
| Hocuspocus v4 trong cùng tiến trình với API | Đơn giản cho giai đoạn này; tách `apps/collab` + Redis extension khi cần scale ngang. |
| Cookie dev trỏ tới user đã bị xóa sau khi seed lại | Header `x-user-id` sai → 401; cookie cũ → quay về user mặc định. |

---

## 20. Phase 2.1 — Word parity: quyết định

| Vấn đề | Quyết định |
|---|---|
| Chế độ gợi ý sửa trên CRDT | Hook `dispatchTransaction` của Tiptap v3 biến transaction cục bộ (1 ReplaceStep) thành mark `insertion` / `deletion`; transaction từ Yjs (`isChangeOrigin`) và undo đi qua nguyên vẹn. Mark mang `id, author, color, at`; gõ liên tục ≤ 20 s dùng lại đúng bộ thuộc tính nên gộp thành một đề xuất. Xoá chữ do chính mình vừa đề xuất thì xoá thật. |
| Track changes khi mở bằng Word | Mark gợi ý → `InsertedTextRun` / `DeletedTextRun` (`w:ins` / `w:del`), nên người dùng Word Accept / Reject được. Văn bản thuần và tìm kiếm dùng "bản đọc khi chấp nhận hết" (bỏ chữ đang gợi ý xoá). |
| Thiết lập trang | Lưu trong `Y.Map('settings')` cạnh nội dung: đồng bộ realtime, có trong snapshot phiên bản, server đọc khi export. |
| Phân trang trên màn hình | Editor không tự phân trang (giống Lark Docs); Print layout hiển thị đúng khổ giấy, lề, header/footer; **Print preview hiển thị PDF thật do server dựng** (phân trang, số trang chính xác). |
| Header/footer + số trang | DOCX: trường `PAGE` / `NUMPAGES`; PDF: template header/footer của Chromium (`pageNumber` / `totalPages`). |
| Mục lục | Node `tableOfContents`: trong editor là danh sách heading sống (bấm để nhảy); DOCX là trường TOC thật (`TOC \h \o "1-3"`) kèm entry cache; HTML/PDF có liên kết tới heading. |
| Tìm & thay thế khi đang gợi ý | Chữ đang bị gợi ý xoá không tính là kết quả tìm kiếm (tránh "Thay tất cả" lặp vô hạn); thay thế trong chế độ gợi ý tạo từng đề xuất riêng. |
| Test | `apps/api/test/docs-word.mjs` (16 kiểm tra đọc thẳng XML trong DOCX và MediaBox của PDF) + `apps/web/e2e/docs-word.mjs` (10 bước, có người thứ hai duyệt gợi ý). |

---

## 21. Phase 2b — Notes & Mind Map: quyết định

| Vấn đề | Quyết định |
|---|---|
| Loại tài nguyên | `note` mới trong `resource_type`; một ghi chú = một tài liệu Yjs chứa **cả** thân ghi chú (`XmlFragment 'default'`) lẫn mind map → một phiên realtime, một lịch sử phiên bản. |
| Lưu mind map | Hai **Y.Map cấp gốc** (`mindmap`, `mindmapEdges`), không lồng dưới một khoá: hai client tạo map lồng cùng lúc sẽ ghi đè nhau (đã gặp khi thử, mất sơ đồ). |
| Undo mind map | `Y.UndoManager` theo người dùng, `captureTimeout: 0`: mỗi thao tác là một bước. Gộp theo thời gian khiến "thêm + xoá" nhanh thành một bước "vô hiệu" và Yjs hoàn tác luôn bước trước đó (đã tái hiện và có test hồi quy). |
| Sổ ghi chú, thuộc tính | `metadata.notebook` (vd `Projects/Q4 Strategy`) và `metadata.properties`; PATCH `/resources/:id` có kiểm tra. |
| Liên kết & backlinks | Node `resourceLink` (`[[`) và `resourceEmbed`; mỗi lần lưu, `DocStore` đồng bộ bảng `resource_links`; `GET /resources/:id/links` trả linked + backlinks đã lọc theo quyền người xem. |
| Dùng chung với Docs | `useLiveEditor` + `editor-kit`: menu `/`, `[[`, task có người phụ trách / hạn chót, nhãn trạng thái, heading gập được — có ở cả Docs và Notes. |
| Test | `apps/api/test/notes.mjs` (10) + `apps/web/e2e/notes-flow.mjs` (12 bước, 2 người). |

---

## 22. Phase 3 — Sheets: quyết định

| Vấn đề | Quyết định |
|---|---|
| Engine | **Univer 1.0.3 OSS** (presets core, filter, sort, conditional formatting, data validation, find-replace, hyperlink) cho lưới, ribbon `classic` và formula engine. Collab/XLSX/chart/pivot của Univer là bản Pro → **không dùng**; tự viết binding Yjs và chuyển đổi XLSX. |
| Mô hình Yjs | `packages/sheet-model`: `Y.Map 'wb'` (name, sheetOrder), `Y.Map 'sheets'` → mỗi sheet có `rows`/`cols` (`Y.Array` id ổn định), `cells` (`Y.Map` khoá `rowId:colId`), `rowMeta`, `colMeta`, `merges` (theo id), `meta`; `Y.Map 'resources'` cho state plugin (filter, CF, validation, link) dạng JSON. Chèn/xoá dòng đồng thời không làm lệch ô người khác đang sửa (có test). |
| Khởi tạo | **Server** tạo workbook khi tạo mới / import / seed / copy; client không bao giờ tự tạo container (tránh hai client cùng tạo map rồi ghi đè nhau — bài học từ Phase 2b). |
| Univer → Yjs | Nghe `CommandExecuted` với mutation không phải `fromCollab`/`onlyLocal`: mutation ô chỉ đánh dấu vùng bẩn; ô được **đọc lại từ Univer** (`getCellRaw` + `getFormulas`) nên style luôn là object, shared formula được mở thành công thức đầy đủ. Cấu trúc (chèn/xoá/di chuyển dòng-cột) áp ngay lên `Y.Array` id. Gộp ghi trong một transaction mỗi tick. |
| Yjs → Univer | Phát lại thành mutation Univer với **`{ fromCollab: true }` — không dùng `onlyLocal`**: `onlyLocal` làm formula engine bỏ qua theo dõi phụ thuộc nên công thức bên nhận không tính lại (đã tái hiện). Không vào undo stack của người nhận. Thay đổi hiếm (thêm/xoá/sắp xếp sheet từ xa, resources plugin, restore phiên bản) → dựng lại workbook từ Y.Doc. |
| Kết quả công thức | Mỗi client tự tính; kết quả (`formula.mutation.set-formula-calculation-result`) được ghi lại vào `v` (debounce 400 ms, chỉ khi khác) để export, tìm kiếm, bản xem phiên bản thấy giá trị hiện tại. Khi mở file luôn tính lại toàn bộ (`initialFormulaComputing: FORCED`). |
| Kiểu boolean | Univer lưu TRUE/FALSE là 1/0 với `t = 3`; `cellValue()` trong sheet-model chuyển về boolean cho XLSX/CSV/HTML. |
| XLSX | ExcelJS phía server: giá trị, ngày → số seri, công thức (shared formula được dịch từng ô), rich text → text, style (font, màu, nền, căn lề, wrap, viền 13 kiểu, định dạng số), độ rộng cột (px ≈ ký tự·7+5), chiều cao dòng (px = pt·4/3), merge, freeze, màu tab, ẩn sheet/dòng/cột, gridlines. Export đặt `fullCalcOnLoad` để Excel tính lại khi mở. Báo cáo import liệt kê phần giữ / giản lược (CF, validation) / bỏ (ảnh, chart, pivot, macro). |
| CSV / PDF / HTML | CSV UTF-8 có BOM (một sheet — sheet đang mở), nhận dạng dấu phân cách `, ; tab`, số/boolean/công thức như Excel. PDF/HTML: bảng theo vùng đã dùng, giữ style, merge, dòng/cột ẩn, **định dạng số kiểu Excel** (`formatValue` trong sheet-model: General, #,##0, %, E+, tiền tệ, section âm/0/text, ngày giờ). |
| Download | File native tải về dạng XLSX; file đã upload vẫn tải về **bản gốc** (giữ hợp đồng Phase 2), nội dung hiện tại lấy qua File → Download as (`/export`). |
| Kiểm chứng công thức | `apps/web/e2e/formula-cases.mjs`: 132 công thức (toán, thống kê, logic, lỗi, text, tra cứu, ngày giờ, tài chính, mảng động, LET) với kết quả của Excel; e2e đọc giá trị thô từ engine và so sánh (sai số tương đối 1e-6). Hiện **132/132 khớp**. |
| Giới hạn đã biết | Tham chiếu vùng trong CF/validation/filter lưu theo chỉ số (không theo id) → sửa cấu trúc đồng thời có thể lệch vùng; undo của mỗi người chỉ gồm thao tác của mình nhưng không được biến đổi theo thao tác từ xa; chưa có con trỏ/vùng chọn của người khác trên lưới; comment theo ô, chart, pivot → 3.1. |
| Test | `apps/api/test/sheets.mjs` (33 kiểm tra: collab, chèn dòng đồng thời, quyền xem, XLSX/CSV/PDF/HTML, import XLSX/CSV/file hỏng, phiên bản, copy, tìm kiếm) + `apps/web/e2e/sheets-flow.mjs` (10 bước, 2 người + parity công thức). |

---

## 23. Phase 4 — Slides: quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | `packages/slide-model`: `Y.Map 'deck'` (name, size, theme), `Y.Array 'slideOrder'`, `Y.Map 'slides'` → mỗi slide có `meta`, `notes: Y.Text`, `elements: Y.Map<id, Y.Map>`. **Mỗi đối tượng là một Y.Map riêng, mỗi thuộc tính một key** → hai người di chuyển / đổi màu cùng một đối tượng không ghi đè nhau (có test). Chữ trong text box/shape là `Y.XmlFragment` cùng encoding với y-prosemirror (gõ chung realtime, undo theo người). Bảng: `cells: Y.Map<"rowId:colId">` với id dòng/cột ổn định. Slide bị hai người di chuyển cùng lúc có thể xuất hiện hai lần trong `slideOrder` → người đọc bỏ trùng. |
| Khởi tạo | Server tạo deck khi tạo mới / import / seed / copy (như Sheets). Presentation có từ trước Phase 4 được tạo deck ở lần mở đầu (`collab-token`). |
| Render | **Một renderer HTML/SVG duy nhất** (`slideHtml`) cho canvas, thumbnail, trình chiếu, bản xem phiên bản và export PDF/PNG/HTML (Chromium) → file xuất giống hệt màn hình. Toạ độ là px ở 96 dpi (16:9 = 1280 × 720 = 13.333″ × 7.5″), cỡ chữ theo pt. Màu theme dạng token (`@accent1`, `@title`…) nên đổi theme là đối tượng đổi màu theo. Inter được ánh xạ sang bản tự host của next/font (`FONT_ALIASES`). |
| Soạn thảo | Lớp "hit" trong suốt theo thứ tự z nhận chuột; kéo/đổi kích thước/xoay (cả khi đã xoay), căn theo đường gióng (Alt để tắt), quét chọn; sửa chữ bằng Tiptap gắn vào fragment của đối tượng; định dạng cả khung khi chưa mở editor (ghi thẳng vào Y.XmlText). Undo/redo: `Y.UndoManager` theo origin cục bộ + y-prosemirror. Hiện diện: awareness `slides {slide, sel, editing}` → khung màu + tên người khác. |
| PPTX export | pptxgenjs: text box/shape/bảng/**biểu đồ native**/ảnh/ghi chú/slide ẩn là đối tượng PowerPoint thật (không phải ảnh chụp). `theme1.xml` được viết lại với bảng màu + font của deck (tên `Master Office: <id>` để import nhận lại đúng theme). Giản lược: nền gradient → màu đầu. |
| PPTX import | Tự đọc OOXML (JSZip + xmldom): kích thước, theme (màu scheme + lumMod/lumOff, font), placeholder kế thừa từ layout/master, nhóm (biến đổi toạ độ con), shape (16 hình + đường/mũi tên), chữ (run, bullet lồng nhau, căn lề, link), ảnh (lưu thành asset), bảng, biểu đồ (bar/col/line/area/pie/doughnut từ cache), nền, ghi chú, slide ẩn, transition. Định dạng lặp trên mọi run được gom lên khung. Báo cáo: SmartArt, OLE, video/audio, animation, freeform → bỏ/giản lược. .ppt/.odp cần LibreOffice. |
| Export khác | PDF (một trang mỗi slide, đúng kích thước), PNG 2× (một slide hoặc zip tất cả), HTML. Ảnh được nhúng data URL nên Chromium không cần gọi API. |
| Biểu đồ ↔ Sheets | `GET /resources/:id/sheet-range?range=A1:D5&sheet=` (kiểm quyền xem) → "Use data from Sheets" / "Refresh from Sheets". |
| Trình chiếu | Toàn màn hình, phím/chuột, fade/push/wipe, màn đen (B), laser (L), bỏ qua slide ẩn; presenter view là cửa sổ riêng (`/present/:id`) đồng bộ qua BroadcastChannel (slide hiện tại + kế, ghi chú, đồng hồ). |
| Giới hạn đã biết | Chưa có group, animation, crop ảnh, video; con trỏ chữ của người khác chỉ hiện ở mức khung ("typing"); xoá slide đồng thời với chỉnh sửa trên slide đó → chỉnh sửa mất cùng slide. |
| Test | `apps/api/test/slides.mjs` (47 kiểm tra: collab, sửa đồng thời, quyền xem, PPTX/PDF/PNG/HTML, import PPTX thật, file hỏng/.ppt, comment theo đối tượng, phiên bản, copy kèm ảnh, tìm kiếm, sheet-range) + `apps/web/e2e/slides-flow.mjs` (15 bước, 2 người + viewer). |

---

## 24. Phase 3.2 — Tab sheet phía trên & Macro: quyết định

| Vấn đề | Quyết định |
|---|---|
| Tab sheet | Theo yêu cầu người dùng (kiểu Lark): thanh `SheetTabs` **phía trên lưới**; footer sheet bar của Univer tắt. Mọi thao tác (chuyển, thêm, đổi tên bằng nhấp đúp, nhân bản, màu, ẩn/hiện, di chuyển, xoá, kéo sắp xếp, danh sách tất cả sheet) đi qua facade Univer → binding Yjs đồng bộ như mọi chỉnh sửa. |
| Ngôn ngữ macro | **JavaScript** với API kiểu **Google Apps Script** (`SpreadsheetApp`, `Sheet`, `Range`, `Logger`, `Browser`, `Utilities`) — người dùng chọn (2026-10-03). Không chạy VBA. |
| Lưu trữ | Trong Y.Doc của chính bảng tính: map top-level `macros` (`id → {name, fn, code, shortcut, updatedBy, updatedAt}`) → đồng bộ realtime, nằm trong lịch sử phiên bản, đi theo khi "Make a copy" (cloneContent chép map). Map top-level được định danh theo tên nên tạo lần đầu từ client là an toàn. |
| Ghi macro | `MacroRecorder` nghe `CommandExecuted` của Univer và dịch thành dòng script tham chiếu tuyệt đối (A1). Lệnh định dạng (`set-style`) không mang vùng → recorder tự theo dõi vùng chọn (`set-selections`) và sheet đang mở. Lệnh chưa hỗ trợ được ghi thành `// Not recorded: …` (không lặng lẽ bỏ qua); undo/redo không ghi. |
| Chạy | Bản chụp workbook (giá trị, công thức, style của vùng đã dùng; tối đa 400k ô) → **Web Worker riêng** (tạo từ `macroWorker.toString()`), trong đó `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `navigator`… bị gỡ trước khi chạy mã người dùng; quá 30 s thì worker bị huỷ và không áp gì. Macro đọc thấy ngay những gì nó vừa ghi (mô hình trong bộ nhớ); kết quả công thức cập nhật sau khi chạy xong (như `flush()` của Apps Script). |
| Áp thay đổi | Worker trả danh sách thao tác (`cells`, `style`, `clear`, `merge`, `insertRows`, `freeze`, `insertSheet`, `toast`…); luồng chính áp qua facade Univer → binding Yjs → mọi người thấy ngay. Lỗi giữa chừng: thay đổi trước lỗi vẫn được áp (giống Apps Script), lỗi hiện ở Output. |
| Quyền | Chỉ editor ghi / sửa / chạy macro (viewer thấy danh sách nhưng nút bị khoá; binding cũng không ghi thay đổi của viewer). |
| .xlsm | `.xlsm` được nhận là bảng tính; `xl/vbaProject.bin` được đọc (CFB + giải nén MS-OVBA + bản ghi `dir`: tên module, stream, offset, codepage), dòng `Attribute VB_*` bị bỏ → map `vba` của tài liệu → panel Macros hiện **"Excel VBA (read-only)"** để người dùng viết lại thành JS. Báo cáo import ghi rõ. |
| Giới hạn | Chưa có trigger (onEdit, theo lịch), chưa ghi tham chiếu tương đối, chưa nhập/xuất macro giữa các file, macro chạy ở trình duyệt người bấm (không chạy nền trên server); mỗi thay đổi của macro là một bước undo của Univer. |
| Test | `apps/api/test/sheets.mjs` (+4: kết quả công thức tách khỏi công thức, export đọc kết quả, copy giữ macro, .xlsm giữ VBA) + `apps/web/e2e/macros-flow.mjs` (8 bước: ghi → lưu → phím tắt → người khác thấy → script vòng lặp/appendRow/công thức/log → lỗi giữ thay đổi trước đó → sandbox không có `fetch` → viewer bị khoá). |

---

## 25. Phase 8 — Forms: quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | `packages/form-model`: định nghĩa form là **Y.Doc** (`Y.Map 'form'` title/description/theme/settings, `Y.Array 'itemOrder'`, `Y.Map 'items'` → mỗi mục một Y.Map, mỗi thuộc tính một key) → nhiều người soạn cùng lúc, có phiên bản, copy như mọi file. **Câu trả lời là dòng Postgres** (`form_responses`: answers jsonb, score, email, edit_token) → báo cáo, CSV, Sheets, không phình Y.Doc. |
| Loại câu hỏi | Short answer, paragraph, multiple choice (+ "Other"), checkboxes, dropdown, file upload, linear scale, rating (sao/tim/like), multiple-choice grid, checkbox grid, date (+ giờ), time; khối tiêu đề-mô tả, ảnh, video (YouTube/Vimeo), **section**. |
| Logic dùng chung | `validateAnswer` (bắt buộc, lựa chọn hợp lệ, số / text / độ dài / regex / số lựa chọn + thông báo tuỳ chỉnh, 1 câu trả lời mỗi cột của lưới), `pagesOf` + `nextPage` (rẽ nhánh theo lựa chọn hoặc "sau section"), `visitedPages`, `scoreOf` / `isCorrect`, `responseColumns` — **cùng mã** chạy ở trang trả lời và server; server bỏ câu trả lời ở trang bị rẽ nhánh bỏ qua. |
| Ai được trả lời | Không cần share file: link là quyền. `access: org` → người trong workspace; `public` → bất kỳ ai có link. Thu thập email: tắt / xác thực (tài khoản đăng nhập) / người trả lời tự nhập. Giới hạn 1 lần (theo tài khoản), cho sửa sau khi gửi (edit token riêng), đóng tay hoặc theo hạn, thông báo khi đóng. |
| Quiz | Điểm, đáp án (lựa chọn: đúng tập; chữ: bất kỳ đáp án nào, không phân biệt hoa-thường/khoảng trắng), phản hồi đúng/sai, công bố điểm ngay hoặc sau; **đáp án không bao giờ gửi tới người trả lời** (`publicForm`). |
| File upload | `/forms/:id/uploads` lưu blob + đăng ký là asset của form → chỉ người xem/sửa form tải được (`/resources/:id/assets/:blob`); giới hạn dung lượng theo câu hỏi. |
| Câu trả lời ↔ Sheets | "Link to Sheets" tạo bảng tính cạnh form, ghi header (Timestamp, Email, Score, mỗi câu / mỗi dòng lưới) + mọi câu trả lời; câu trả lời mới được **nối dòng realtime** (transaction Yjs trên sheet, người ghi là người trả lời hoặc chủ form). CSV UTF-8 BOM cùng cột. Tab Responses: tóm tắt (thanh %, histogram, bảng lưới, danh sách chữ, file), theo câu, từng người (xoá), điểm trung bình; cập nhật live qua stateless message. |
| Phát hành | Trang `/f/:id` ngoài app shell, theme (màu, nền, font, ảnh header), thanh tiến độ, xáo trộn câu/lựa chọn, nháp lưu trên máy, link điền sẵn `?entry.<id>=…`, mã nhúng iframe, xem tóm tắt (nếu bật). |
| Sửa lỗi kèm theo | `DocStore.save` chỉ ghi `updated_by`/activity khi người sửa là UUID thật — trước đó một lần ghi hệ thống làm lưu thất bại (dữ liệu chỉ còn trong RAM). |
| Giới hạn | "Chỉ 1 câu trả lời" cho form công khai (cần đăng nhập). QR, nhập câu hỏi, e-mail thông báo và chấm tay: §61–§63. |
| Test | `apps/api/test/forms.mjs` (38 kiểm tra) + `apps/web/e2e/forms-flow.mjs` (9 bước: 2 người soạn, đổi loại, lựa chọn, bắt buộc, trả lời có lỗi → rẽ nhánh → gửi, Responses live, quiz, đóng form, Send, viewer). |


## 26. Phase 3.1 — Sheets: ghi chú, bình luận, ảnh, bảng & biểu đồ

| Vấn đề | Quyết định |
|---|---|
| Note / comment / ảnh / table | Dùng preset OSS của Univer 1.0.3 (note, thread-comment, drawing, table); trạng thái plugin đồng bộ như mọi resource (`Y.Map 'resources'`). Người dùng Univer mang tiền tố `Owner_` / `Reader_` vì quyền cục bộ của Univer suy ra từ id; quyền thật vẫn do Master Office kiểm. |
| Không dựng lại lưới | Thay đổi resource từ xa chỉ nạp lại **plugin đổi thật** (`onUnLoad` / `onLoad`), người đang gõ không bị gián đoạn. Ngoại lệ dựng lại cả workbook: **protection** (permission point gắn với workbook) và **drawing** (ảnh / biểu đồ chỉ được vẽ khi workbook nạp). |
| Biểu đồ | Tự làm (chart của Univer là bản Pro). Định nghĩa trong `Y.Map 'charts'` (`packages/sheet-model/src/charts.ts`): loại (column, bar, line, area, pie, doughnut), vùng dữ liệu theo **id dòng/cột** (chèn/xoá dòng nơi khác không làm lệch), tiêu đề, header, đổi hàng/cột, legend, nhãn. Vị trí là **DOM drawing** của Univer (kéo, đổi cỡ, đồng bộ, undo như ảnh); component React vẽ bằng `chartSvg` dùng chung với Slides, cập nhật khi dữ liệu / công thức đổi. Insert → Chart lấy vùng chọn (hoặc vùng dữ liệu), nhấp đúp mở panel Chart. |
| Công cụ dữ liệu | Menu **Data**: Column stats (panel theo ô đang chọn: số dòng, trống, giá trị khác nhau, sum/avg/median/min/max, tần suất), Remove duplicates (so sánh mọi cột của vùng chọn, không phân biệt hoa-thường/khoảng trắng; dòng duy nhất dồn lên, giữ công thức), Trim whitespace (bỏ qua ô công thức), Split text to columns (tự nhận dấu phân cách hoặc chọn , ; . khoảng trắng; số được chuyển thành số). **Insert → Checkbox** = data validation checkbox. Mỗi thao tác là một lệnh `setValues` / `setDataValidation` → một bước undo, đồng bộ như sửa ô. |
| Giới hạn | Biểu đồ chưa xuất ra XLSX / PDF; chưa có scatter, combo, trục phụ, trendline. |
| Test | `apps/web/e2e/sheets-flow.mjs`: note & comment đồng bộ không dựng lại lưới; chèn biểu đồ → người kia thấy → đổi loại → xoá. |

## 27. Phase 3.1 — Pivot table: quyết định

| Vấn đề | Quyết định |
|---|---|
| Tự làm | Pivot của Univer là bản Pro. Định nghĩa trong `Y.Map 'pivots'` (`packages/sheet-model/src/pivots.ts`): vùng nguồn theo id dòng/cột (dòng đầu = tên trường), **trường là id cột** (chèn cột nơi khác không đổi nghĩa), Rows / Columns (thứ tự tăng-giảm), Values (SUM, COUNTA, COUNT, COUNTUNIQUE, AVERAGE, MIN, MAX, MEDIAN), Filters (giá trị bị ẩn), totals. `computePivot` thuần (không phụ thuộc UI) dựng lưới giống Google: hàng tiêu đề cho trường cột, tên trường hàng + nhãn giá trị, subtotal cho trường hàng ngoài, Grand Total hàng & cột, "(blank)". |
| Kết quả là ô thật | Bảng được **ghi thành giá trị ô** trên sheet đích → công thức, biểu đồ, xuất XLSX/PDF dùng được. Ghi bằng mutation `set-range-values` (đồng bộ như sửa ô, **không vào undo**; undo sửa nguồn sẽ tính lại); chỉ ghi khi khác nội dung hiện có; ghi rỗng phần thừa khi bảng nhỏ lại (`out`). |
| Ai tính lại | Chỉ editor **gây ra** thay đổi: sửa cục bộ (không phải replay `fromCollab`), kết quả công thức ngay sau sửa cục bộ, đổi định nghĩa cục bộ. Người khác nhận ô đã ghi → không ai bị chèn bước lạ vào lịch sử. Khi mở file, editor kiểm tra và làm mới bảng lỗi thời (ví dụ dòng do Forms nối từ server). Viewer không bao giờ ghi. |
| UI | Insert → Pivot table (vùng chọn hoặc vùng dữ liệu) tạo sheet "Pivot table N" + panel editor; nút **Edit pivot table** hiện khi ô chọn nằm trong bảng; xoá sheet đích xoá luôn định nghĩa. |
| Giới hạn | Chưa có calculated field, "show as % of", nhóm theo ngày/khoảng số, GETPIVOTDATA; server chưa tự tính lại khi nguồn đổi lúc không ai mở file. |
| Test | `sheets-flow.mjs`: dựng bảng (rows, columns, values) → Mika sửa nguồn → Claudia nhận bảng mới → filter → xoá. |

## 28. Phase 3.1 — Con trỏ cộng tác, named range, bảo vệ vùng: quyết định

| Vấn đề | Quyết định |
|---|---|
| Con trỏ người khác | Vùng chọn + sheet đang xem đi qua **awareness** (`sheet: {sheetId, range}`); mỗi người khác được vẽ bằng `FRange.highlight()` theo màu của họ (Univer lo cuộn / zoom / freeze) + nhãn tên qua canvas popup (`presence.tsx`). Vẽ lại khi awareness đổi, đổi sheet, đổi cấu trúc, và định kỳ 4 s (sau một lần dựng lại workbook). |
| Named range, xoay chữ | Defined names là resource (`SHEET_DEFINED_NAME_PLUGIN`) → đồng bộ như plugin khác, công thức `=SUM(Tên)` tính đúng ở mọi máy. Xoay chữ là style `tr` → đồng bộ sẵn. |
| Bảo vệ vùng / sheet | Authz mặc định của Univer chỉ dựa vai trò (mọi editor đều là "owner"). Thay bằng `MoAuthzService` (`authz.ts`, `override` của `createUniver`): mỗi rule lưu **người tạo**, danh sách được sửa, phạm vi xem/sửa; dữ liệu đi cùng workbook (resource). Chỉ người tạo đổi / gỡ được bảo vệ; viewer không bao giờ sửa. Sau khi workbook được dựng lại live, `refreshProtection` tính lại permission point (Univer chỉ tính lúc mở trang). |
| Giới hạn | Bảo vệ được kiểm trong editor (như Google: chống sửa nhầm), server chưa chặn ghi Yjs vào vùng bảo vệ. |
| Test | `sheets-flow.mjs`: Mika thấy con trỏ của Claudia, xoay chữ, `=SUM(Nums)`; vùng bảo vệ cho Mika sửa, Sora (editor ngoài danh sách) bị chặn, kể cả sau khi mở lại. |

## 29. Phase 3.1 — Plugin state ⇄ XLSX: quyết định

| Vấn đề | Quyết định |
|---|---|
| Xuất | `apps/api/src/sheets/xlsx-resources.ts` đọc JSON plugin của Univer trong `resources`: conditional format (cellIs, text, công thức, duplicate/unique → COUNTIF, top/bottom, trên/dưới trung bình, color scale, data bar, icon set mặc định), data validation (list — mảng JSON hoặc tham chiếu, checkbox → list TRUE/FALSE, số, ngày, độ dài, custom), note, hyperlink, named range → ExcelJS. Thứ tự ưu tiên CF giữ nguyên (Univer: rule mới nhất trước). |
| Nhập | Chiều ngược lại cho cùng các loại; validation ExcelJS trả về từng ô → gộp lại thành dải theo cột; báo cáo import liệt kê số CF/validation/note/named range giữ được và phần không có tương đương. |
| Giới hạn | Biểu đồ, pivot (Excel PivotCache), slicer, sparkline, icon set tuỳ chỉnh, CF theo ngày chưa đi qua XLSX; bảng pivot vẫn ra Excel dưới dạng giá trị ô. |
| Test | `sheets-flow.mjs`: upload XLSX có CF + validation + note + named range → Univer hiển thị, `=SUM(Amounts)` = 45 → export lại có đủ. |

## 30. Phase 4.1 — Slides: nhóm đối tượng & animation: quyết định

| Vấn đề | Quyết định |
|---|---|
| Group | Khoá vô hướng `group` (id nhóm) trên từng element — hai người sửa hai thuộc tính khác nhau không đè nhau. Một cấp như Google Slides. Click chọn cả nhóm; khung nhóm có 8 tay nắm co giãn mọi thành viên (góc giữ tỉ lệ); nhấp đúp "vào" nhóm để chọn từng thành viên, nhấp đúp lần nữa để sửa chữ. Ctrl+Alt+G / Ctrl+Alt+Shift+G, menu Arrange, menu chuột phải. Sao chép / dán / nhân bản slide cấp id nhóm mới (`regroup`). |
| Animation | Khoá `anim` = `{effect, start: click/with/after, dur, delay, order}`; 15 hiệu ứng vào/ra (appear, fade, fly in/out 4 hướng, zoom, spin…). `animTimeline` (dùng chung) chia bước: trước click đầu = bước 0 (chạy khi slide hiện), mỗi "on click" mở bước mới, "with" chạy cùng mục trước, "after" chạy khi mục trước xong. `animCss` → CSS theo element qua `RenderOptions.elementCss`; keyframes nằm trong `SLIDE_CSS` dùng thuộc tính `translate`/`scale`/`rotate` nên không đè `transform: rotate` của element. |
| UI | Tab **Motion**: chuyển trang + danh sách animation (hiệu ứng, bắt đầu, thời lượng, độ trễ, lên/xuống, xoá), nút Play xem thử. Menu Slide → "Transition & animations…", chuột phải → Animate. |
| Trình chiếu | Mỗi click chạy bước kế tiếp, hết bước mới sang slide; lùi = bỏ bước gần nhất (không chạy hiệu ứng), lùi sang slide trước hiện trạng thái cuối. Cửa sổ người thuyết trình hiển thị đúng bước hiện tại. |
| Giới hạn | Animation & nhóm chưa xuất ra PPTX (pptxgenjs không hỗ trợ) và chưa nhập từ PPTX; một animation mỗi đối tượng; chưa có motion path. |
| Test | `apps/web/e2e/slides-motion-flow.mjs` (5 bước, 2 người): nhóm → co giãn → vào nhóm → bỏ nhóm → animation → trình chiếu từng click. |

## 31. Phase 4.1 — Slides: cắt & chỉnh ảnh, số trang: quyết định

| Vấn đề | Quyết định |
|---|---|
| Crop | Khoá `crop` = `{l,t,r,b}` (tỉ lệ cắt mỗi cạnh của ảnh gốc). Đổi crop giữ nguyên tỉ lệ và vị trí ảnh trên slide: khung co/giãn theo phần nhìn thấy (`DeckStore.setCrop`). Render: ảnh đầy đủ phóng to + dịch trong khung `overflow:hidden`. PPTX: xuất bằng crop của pptxgenjs (→ `a:srcRect`), nhập đọc `a:srcRect` (trước đây chỉ báo "degraded"). |
| Chỉnh ảnh | `style.brightness` / `contrast` (−100…100) và `recolor` (grayscale, sepia, washout) → CSS filter dùng chung cho editor, trình chiếu, PDF/PNG. PPTX chưa mang được (báo trong export report). |
| Số trang | Thiết lập cả bộ `deck.numbers = {show, skipTitle}` (Insert → Slide numbers, tab Design). Số thứ tự `slide.no` tính khi đọc deck (không lưu) — DeckStore chỉ tạo object mới cho slide đổi số nên thumbnail khác không vẽ lại. PPTX: trường số trang native (`sldNum`). |
| Test | `slides-motion-flow.mjs` thêm 2 bước: crop 25% trái → khung 400→300 px, x 200→300, người kia thấy; brightness + grayscale; bật số trang, bỏ qua slide tiêu đề. Kiểm tra vòng PPTX export→import giữ crop. |

## 32. Phase 4.1 — Slides: video & audio: quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | Element `video` / `audio`; `src` = link YouTube (watch, youtu.be, shorts, embed) hoặc file đã tải lên (asset của bài trình chiếu); `media` = `{start, end, autoplay, muted, loop}`. |
| Hiển thị | Editor: nhấp đúp video/audio để phát ngay tại chỗ (nút × để dừng). Thumbnail, PDF/PNG: ảnh tĩnh (thumbnail YouTube hoặc khung đầu của video) + biểu tượng Play; audio là biểu tượng loa. Trình chiếu (`RenderOptions.live`): YouTube qua `youtube-nocookie.com/embed` (start, end, autoplay, mute, loop), file qua `<video controls>` / `<audio>` với `#t=start,end`. Click vào video/loa trong lúc trình chiếu điều khiển phát, không chuyển slide. |
| Server | Asset nhận thêm `video/*`, `audio/*` (tối đa 100 MB; ảnh vẫn 20 MB). Tải asset hỗ trợ **HTTP Range** (206 + `Content-Range`, S3 `Range`) để tua video. |
| PPTX | Xuất: YouTube → online video, file → nhúng media (pptxgenjs). Nhập: `a:videoFile` / `a:audioFile` → element tương ứng (loại theo MIME của file, vì có công cụ ghi audio dưới `videoFile`); link YouTube giữ nguyên. Start/end/autoplay/loop chưa đi qua PPTX (báo trong report). |
| Giới hạn | Chưa có Google Drive picker; đổi bước animation trên slide đang phát video sẽ nạp lại trình phát. |
| Test | `slides-motion-flow.mjs`: chèn link YouTube qua dialog → người kia thấy thumbnail, bật autoplay; tải file WAV → asset, Range 206; trình chiếu có iframe autoplay và `<audio>`. Vòng PPTX export→import giữ YouTube, MP4, MP3. |

## 33. Phase 4.1 — Slides: đường nối (connector): quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | Line/arrow có thêm khoá `conn = {kind: straight / elbow / curved, from?: {id, site}, to?: {id, site}}`, site = giữa cạnh n/e/s/w (tính cả xoay). Mã ở `packages/slide-model/src/connectors.ts`. |
| Đi theo hình | Hình học của đầu mút đã bám được **tính khi vẽ** (`resolveConnectors`) — editor, thumbnail, trình chiếu, PDF/PNG, PPTX đều dùng. Di chuyển một hình không phải ghi vào các đường nối của nó (không xung đột khi hai người cùng sửa); hộp lưu trong element chỉ là phương án dự phòng khi hình bị xoá. |
| Editor | Kéo đầu mút: hiện 4 điểm nối của hình gần nhất, bắt dính trong 14 px (Alt để bỏ bắt dính); thả ra ngoài thì tách. Kéo cả đường nối đi chỗ khác thì nhả các hình (trừ khi hình di chuyển cùng). Insert → Straight / Elbow / Curved connector; tab Format: kiểu đường nối, mũi tên. |
| Vẽ | Elbow: ra vuông góc với cạnh đang bám, gấp ở giữa; curved: Bézier bậc ba với tay nắm theo pháp tuyến cạnh. PPTX: xuất đúng vị trí, elbow/curved thành đường thẳng (báo trong report). |
| Test | `slides-motion-flow.mjs`: kéo hai đầu elbow connector vào cạnh phải / trái của hai hình → người kia thấy `from/to`; người kia di chuyển hình → đường nối của người này đi theo; kéo đường nối → tách. |

## 34. Phase 4.1 — Slides: sơ đồ & word art: quyết định

| Vấn đề | Quyết định |
|---|---|
| Sơ đồ | `diagramElements(kind, {count, color}, size)` (`packages/slide-model/src/diagrams.ts`) sinh một **nhóm** hình + chữ + connector: Process (mũi tên nối các bước), Timeline (trục + mốc trên/dưới), Cycle (vòng tròn nối mũi tên theo chiều kim đồng hồ), Hierarchy (gốc → nhánh bằng elbow connector), Grid, Relationship (Venn). Màu là tham chiếu theme (`@accentN`) nên đổi theme là đổi màu; một màu hoặc "Multi". Sau khi chèn là hình thường: sửa chữ, kéo, bỏ nhóm. |
| Hộp thoại | Insert → Diagram…: 6 kiểu có hình xem trước, số mục (+/−, giới hạn theo kiểu), màu, xem trước lớn. |
| Sao chép | Dán / nhân bản / nhân bản slide cấp id mới và **nối lại connector** với bản sao của các hình được sao chép cùng (`remapConnectors`) — trước đây bản sao sẽ trỏ về hình gốc. |
| Word art | `style.outline` + `outlineWidth` (viền chữ, vẽ sau phần tô bằng `paint-order` nên viền dày không ăn vào nét chữ). Insert → Word art chèn khung chữ lớn, chọn sẵn chữ mẫu; tab Format: "Text outline" cho mọi khung chữ. PPTX: viền chữ native (`a:ln` của run). |
| Test | `slides-motion-flow.mjs`: hierarchy 4 mục → 7 phần tử một nhóm, 3 connector trỏ trong nhóm; Ctrl+D → nhóm thứ hai với connector của riêng nó; word art thay chữ mẫu, có viền. |

## 35. Phase 4.1 — Slides: layout, template, theme builder: quyết định

| Vấn đề | Quyết định |
|---|---|
| Layout | Thêm 5 layout của Google Slides: Section title and description, One column text, Main point, Big number, Caption (placeholder có sẵn: title / subtitle / body / body2). Ảnh thu nhỏ layout giờ được **vẽ từ chính placeholder** bằng renderer chung thay vì vẽ tay. Nhập PPTX nhận thêm tên layout "big number", "main point", "caption". |
| Template | `packages/slide-model/src/templates.ts`: Pitch deck, Project status, Marketing plan, Workshop, Team meeting — mỗi cái là theme + các slide đã điền (layout, sơ đồ, bảng, biểu đồ). `POST /resources {type:'presentation', template}` → server dựng deck bằng `templateDeck`. Trang Slides có hàng "Start a new presentation" (Blank + template, ảnh xem trước dựng sau khi mount để tránh lệch hydration do id ngẫu nhiên). |
| Theme builder | Tab Theme → "Customize theme": màu nền, tiêu đề, chữ, muted, 6 accent, font tiêu đề / nội dung. Sửa là ghi theme `id: 'custom'` của bài (đồng bộ như mọi thay đổi theme); mọi màu tham chiếu `@accentN`, `@title`… đổi theo. |
| Test | `slides-motion-flow.mjs`: tạo từ template Workshop (6 slide, theme Forest) → layout Big number → accent 1 tuỳ chỉnh, người kia thấy. |

## 36. Phase 2.2 — Docs: smart chip, building block, bookmark: quyết định

| Vấn đề | Quyết định |
|---|---|
| Smart chip | Node inline (atom) trong `packages/doc-model/src/chips.ts`: `dateChip` (ngày + định dạng ngắn / dài / ISO), `dropdownChip` (danh sách lựa chọn có màu của riêng chip + giá trị; preset Project status / Review status / Priority), `placeChip` (tên → mở Google Maps). Chèn bằng **@** (`@today`, `@tomorrow`, `@date`, `@dropdown`, `@place` — hiện trước danh sách người) hoặc **/**. Node view: bấm để đổi ngày / chọn giá trị / sửa lựa chọn / đổi tên địa điểm. |
| Building block | Menu / → "Building blocks": Meeting notes, Email draft, Project roadmap, Decision log — nội dung có sẵn chip ngày và dropdown. |
| Bookmark & link nội bộ | Node `bookmark` (anchor vô hình, hiện cờ nhỏ trong editor). Hộp thoại Link (Ctrl+K, hoặc / → "Link to heading or bookmark") liệt kê heading và bookmark; chọn heading thì tự đặt bookmark ở đầu heading. Link `#bm-<id>`: Ctrl/⌘-click (khi sửa) hoặc click (khi xem) cuộn tới đó. |
| Xuất | HTML: chip là `span.chip` (dropdown theo màu, place là link Maps), bookmark `<a id="bm-…">`. DOCX: chip thành chữ (dropdown / status có màu), place thành hyperlink, bookmark thành bookmark Word, `#bm-…` thành hyperlink nội bộ. Sửa luôn: status pill và page link trước đây bị mất khi xuất DOCX. |
| Sửa lỗi kèm theo | `PopupList` (menu / và [[) trả về kết quả `scrollIntoView` từ `useEffect` — Chromium mới trả về Promise, React coi là cleanup và báo "destroy is not a function". |
| Test | `apps/web/e2e/docs-chips-flow.mjs` (6 bước, 2 người): @today, /dropdown, @place, building block, link tới heading (link nằm đúng chỗ con trỏ), DOCX/HTML export. |

## 37. Phase 2.2 — Docs: chú thích cuối trang & phương trình: quyết định

| Vấn đề | Quyết định |
|---|---|
| Footnote | Node inline `footnote` mang nội dung chú thích (`text`); **số không lưu** — editor đánh số bằng CSS counter, xuất file đếm theo thứ tự, nên chèn / xoá / di chuyển chú thích tự đánh lại số. Ctrl+Alt+F (như Google Docs), Insert → Footnote, / → Footnote: chèn rồi đưa con trỏ xuống ô chú thích ngay (render đồng bộ bằng `flushSync` để không mất phím gõ đầu). Danh sách chú thích sửa trực tiếp dưới tài liệu; bấm số trong bài để nhảy tới. Nội dung chú thích có trong tìm kiếm. |
| Phương trình | Node inline `equation` (LaTeX), dàn trang bằng **KaTeX** (thêm vào `doc-model`). Editor: popover gõ LaTeX, nút ký hiệu (x², phân số, căn, Σ, ∫, chữ Hy Lạp…), xem trước trực tiếp. Xuất HTML / PDF: MathML (không cần CSS / font). |
| Xuất | HTML: `<sup class="fn">` + mục `footnotes` cuối bài có link qua lại. DOCX: **footnote thật của Word** (`footnotes.xml`); phương trình là mã LaTeX đặt font Cambria Math (chưa chuyển được sang OMML). |
| Test | `docs-chips-flow.mjs` +2 bước: hai footnote chèn ngược thứ tự → đánh số theo vị trí, chữ không lọt vào thân bài; phương trình LaTeX → KaTeX ở máy người kia; HTML có `<math>` và mục footnotes, DOCX có `footnotes.xml`. |

## 38. Phase 2.2 — Docs: pageless, watermark, viewing, viền & nền đoạn văn: quyết định

| Vấn đề | Quyết định |
|---|---|
| Pageless | Thiết lập của tài liệu `pageSetup.pageless` (File → Page setup → Pages / Pageless, như Google Docs) — khác "Print layout" là tuỳ chọn hiển thị của từng người. Pageless: không trang, không header/footer, chữ rộng theo cửa sổ (tối đa 1180 px), ẩn page break; Print layout bị khoá. Xuất PDF / DOCX vẫn chia trang. |
| Watermark | `pageSetup.watermark = {text | image, opacity}` (Insert → Watermark…). Editor (print layout): lớp nền lặp mỗi chiều cao trang, nằm sau chữ (`isolate` + `-z-10`). PDF / HTML: phần tử `position: fixed` — Chromium in lặp lại ở mọi trang; chữ là SVG xoay chéo (`watermarkSvg`), ảnh được server nạp kèm khi xuất. DOCX chưa có watermark. |
| Viewing | Chế độ thứ ba bên cạnh Editing / Suggesting (chỉ hiện cho người có quyền sửa): editor không sửa được, thanh công cụ khoá, đề xuất hiển thị như đã chấp nhận (ẩn phần bị xoá, bỏ tô phần thêm). Chỉ ảnh hưởng người đang xem. |
| Viền & nền | Thuộc tính đoạn văn / heading `border` (all / left / top / bottom / topBottom), `borderWidth`, `borderColor`, `shading` (Format → Borders and shading…). CSS dùng chung (`borderShadingCss`) cho editor và HTML / PDF; DOCX: `w:pBdr` + `w:shd`. |
| Sửa lỗi kèm theo | Một hook mới đặt sau lệnh `return` sớm làm trang Docs không mở được (React: thứ tự hook) — đã chuyển lên trước. |
| Test | `docs-chips-flow.mjs` +3 bước: viền + nền đồng bộ; pageless (Print layout bị khoá ở máy người kia) → về Pages + watermark DRAFT hiện trong print layout; Viewing → không sửa được → Editing. Export: DOCX có `w:pBdr`/`w:shd`, HTML có watermark. |

## 39. Phase 2.2 — Docs: tab tài liệu: quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | Mỗi tab là một **XmlFragment** Yjs riêng: tab đầu là fragment `default` có sẵn (tài liệu cũ không cần chuyển đổi), các tab sau là `tab:<id>`. Danh sách `settings.tabs = [{id, title}]` (`packages/doc-model/src/tabs.ts`). Hai người sửa hai tab không đụng nhau. |
| Editor | Cột trái "Document tabs" (thay cột Outline): thêm (đặt tên ngay), đổi tên (nhấp đúp / menu), lên / xuống, xoá (trừ tab đầu); mục lục của tab đang mở nằm dưới tên tab. Đổi tab = tạo lại editor trên fragment của tab (`useLiveEditor({ field })`); tab đang mở nằm trên URL `?tab=`. |
| Bình luận | Anchor lưu thêm `tab`; mỗi tab chỉ hiện bình luận của mình, tab khác hiện số bình luận đang mở. |
| Server | Đọc để xuất / tìm kiếm / link / xem phiên bản: **mọi tab** (`documentJSON`) — mỗi tab sau bắt đầu trang mới với tên tab là Heading 1. Khôi phục phiên bản thay **mọi tab và settings** (`replaceDocument`). Tạo bản sao chép mọi tab và settings — sửa luôn lỗi cũ: bản sao trước đây mất page setup. Import Word vẫn ghi vào tab đầu. |
| Sửa lỗi kèm theo | Đếm từ đọc storage của editor vừa bị huỷ khi đổi tab ("Cannot read properties of undefined (reading 'words')"). |
| Giới hạn | Chưa có tab con, emoji cho tab, kéo thả để sắp xếp; tab đầu không xoá được. |
| Test | `docs-chips-flow.mjs`: tab "Appendix" có chữ và bình luận riêng (không lẫn với tab đầu ở máy người kia); HTML export có cả hai tab; bản sao giữ tab và watermark. |

## 40. Phase 2.2 — Docs: chia cột & Markdown: quyết định

| Vấn đề | Quyết định |
|---|---|
| Cột | Node khối `columns` (2–3 `column`, mỗi cột chứa khối thường) — Google Docs đặt cột theo section, ở đây là một khối đặt được ở bất kỳ đâu. Format → One / Two / Three columns, / → 2 columns / 3 columns: các khối đang chọn vào cột đầu; đổi số cột giữ nội dung (cột bị bỏ dồn vào cột cuối); "One column" trả về văn bản thường. Editor: CSS grid, viền cột chỉ hiện khi sửa. HTML / PDF: grid; DOCX: bảng một hàng không viền (cột Word gắn với section nên không đặt giữa trang được). |
| Markdown ra | `toMarkdown` (`packages/doc-model/src/columns-md.ts`): heading, đậm / nghiêng / gạch / code / link, danh sách, việc cần làm, trích dẫn, code block, bảng, ảnh, phương trình `$…$`, chip thành chữ; đề xuất xoá bị bỏ. Edit → Copy as Markdown: vùng chọn (dùng `doc.cut` để giữ khối bao quanh) hoặc cả tài liệu. |
| Markdown vào | `markdownToHtml` → schema của editor. Dán chữ thường trông như Markdown (`looksLikeMarkdown`: heading, ≥ 2 dòng danh sách / bảng / link…) tự thành định dạng; tắt ở Tools → Automatically detect Markdown (lưu trên máy). Edit → Paste from Markdown để dán chủ động. Đã kiểm tra vòng Markdown → tài liệu → Markdown giữ nguyên. |
| Test | `docs-chips-flow.mjs` +2 bước: Two columns (người kia thấy 2 cột, chữ gõ ở cột phải); dán Markdown → heading, chữ đậm trong danh sách, bảng ở máy người kia; Copy as Markdown → clipboard có `## …`; HTML export có cột. |

## 41. Phase 2.2 — Docs: biểu đồ từ Sheets & so sánh tài liệu: quyết định

| Vấn đề | Quyết định |
|---|---|
| Biểu đồ | Node khối `docChart` (`packages/doc-model/src/doc-chart.ts`): thông số giống biểu đồ của Slides (loại, tiêu đề, danh mục, chuỗi số liệu, nguồn Sheets). `doc-model` không phụ thuộc `slide-model`: nơi vẽ truyền `chartSvg` vào (`renderChart`). Insert → Chart… / / → Chart: liên kết một vùng của bảng tính (dùng lại `LinkSheet` của Slides, đọc qua `/sheet-range`) hoặc biểu đồ mẫu. Chọn biểu đồ: đổi loại, tiêu đề, **Update** (đọc lại vùng liên kết), xoá. |
| Xuất biểu đồ | HTML / PDF: SVG. DOCX: server vẽ từng biểu đồ trong trình duyệt headless của dịch vụ PDF và chụp PNG (`chart:<n>`), chèn như ảnh. |
| So sánh | Tools → Compare documents…: chọn tài liệu khác → `POST /resources/:id/compare` tạo tài liệu "Comparison of A and B" cùng thư mục, mở thẳng panel Suggestions. `compareDocuments` (`compare.ts`): khớp khối bằng LCS; khối chứa khối (danh sách, callout, trích dẫn, cột) so **từng phần tử con**; đoạn sửa (≥ 40 % từ chung) so từng từ; còn lại là xoá / thêm cả khối. Khác biệt là đề xuất thật (Accept / Reject, Accept all) mang tên tài liệu so sánh. |
| Sửa lỗi kèm theo | Xuất DOCX phần chia cột dựng nội dung cột hai lần → số footnote / biểu đồ trong cột bị lệch (biểu đồ trong cột mất ảnh). |
| Giới hạn | Biểu đồ: chưa sửa bảng số liệu ngay trong Docs (dùng Sheets hoặc biểu đồ mẫu), chưa kéo đổi kích thước. So sánh: định dạng (đậm / nghiêng) và thuộc tính khối không được so, chỉ nội dung. |
| Test | `docs-chips-flow.mjs` +2 bước: biểu đồ liên kết "Sales Report" → người kia thấy, nút Update, đổi sang Line; so sánh với bản sao cũ → tài liệu mới có `ins` / `del`; HTML có `<figure class="chart"><svg`, DOCX có ảnh PNG. |

## 42. Chung — Publish to web & nhúng: quyết định

| Vấn đề | Quyết định |
|---|---|
| Phạm vi | Docs, Wiki, Sheets, Slides: File → Publish to web… (`PublishDialog` dùng chung). Forms đã có trang trả lời công khai riêng. |
| Lưu | `resources.metadata.publish = {token, at, by}` — token ngẫu nhiên 128 bit; publish lại giữ nguyên link; Stop publishing xoá → link trả 404. Sự kiện `resource.published` / `unpublished` trong activity. |
| Trang | `GET /pub/:token` (Next rewrite `/pub/:token` → API): **luôn là nội dung hiện tại** (render lúc xem bằng chính bộ xuất HTML — ảnh nhúng dạng data URI, tài liệu mọi tab, bảng tính mọi sheet, slides thu nhỏ theo cửa sổ); không có bình luận, lịch sử, đề xuất chưa duyệt. Thanh "Published with Master Office"; `noindex`; cache 60 s. Render với quyền chủ sở hữu nhưng không ghi sự kiện export mỗi lần mở. |
| Nhúng | `?embed=1`: bỏ thanh trên; `Content-Security-Policy: frame-ancestors *`; dialog cho sẵn mã `<iframe>` (960×569 cho slides, 800×600 cho tài liệu / bảng tính). |
| Lưu ý triển khai | Khi bật đăng nhập thật (identity module), `/pub/*` phải nằm ngoài lớp xác thực. |
| Test | `apps/web/e2e/publish-flow.mjs` (4 bước): publish tài liệu → link + mã nhúng; trình duyệt không cookie xem được, không sửa được, nội dung mới hiện ngay; embed; Stop publishing → 404; Sheets và Slides cũng publish được. |

## 43. Chung — Activity dashboard: quyết định

| Vấn đề | Quyết định |
|---|---|
| Phạm vi | Docs: Tools → Activity dashboard; Sheets, Slides: File → Activity dashboard. Chỉ người có quyền **editor** (API trả 403 với viewer; menu bị tắt). |
| Ghi lượt xem | Bảng `resource_views(resource_id, user_id, day, count, last_at)`, khoá chính (resource, user, day) — mỗi người mỗi ngày một dòng, upsert `count + 1`. Ghi khi cấp `collab-token` (mở trình soạn thảo = một lượt xem); lỗi ghi chỉ log, không chặn mở file. Trang publish công khai không tính. |
| Endpoint | `GET /api/resources/:id/activity-dashboard` → `viewers` (lần xem cuối, tổng lượt), `trend` 30 ngày (`generate_series`: số người xem khác nhau + số bình luận mỗi ngày, ngày trống = 0), `sharing` (audit: created, acl.changed, published, unpublished, moved — 40 mục mới nhất). |
| Giao diện | Tabs: Viewers (bảng + "Has access, not viewed yet" từ danh sách thành viên), Viewer trend, Comment trend (cột một chuỗi, đầu bo tròn, tooltip khi hover cả cột ngày — tự neo trái/phải để không tràn), Sharing history. |
| Test | `publish-flow.mjs` bước 5: Mika mở tài liệu → Claudia thấy cả hai người xem, có cột hôm nay, lịch sử có "published it to the web". |

## 44. Chung — Thư viện templates (Docs, Sheets): quyết định

| Vấn đề | Quyết định |
|---|---|
| Nguồn | Template là **code trong model dùng chung**, giống Slides (§35): `doc-model/templates.ts` (`DOC_TEMPLATES`: Meeting notes, Project proposal, Weekly report, Product spec, Business letter, Resume) và `sheet-model/templates.ts` (`SHEET_TEMPLATES`: To-do list, Monthly budget, Invoice, Project tracker, Weekly schedule, Expense report). Không lưu trong DB → không cần seed, có version theo git, thumbnail và file tạo ra luôn khớp nhau. |
| Tạo file | `POST /api/resources {type, name, template}`. Spreadsheet: `sheets.init(id, templateWorkbook(...))`. Document: `docs.fillTemplate` → `collab.replaceContent` (giống import DOCX). Template không tồn tại → file trống. |
| Bảng tính | Ô công thức chỉ lưu `f` (không có kết quả cache); lưới tự tính khi mở, XLSX export yêu cầu Excel tính lại. Ngày dùng serial date + định dạng `yyyy/mm/dd`; hàng tiêu đề tô màu nhấn của template, cố định hàng tiêu đề, màu tab. |
| Thumbnail | Docs: HTML của `toHTML` (cùng bộ xuất) trong trang 640 px, thu nhỏ bằng `transform: scale` (`.mo-tpl-page`). Sheets: góc trên-trái sheet đầu (cột nguyên vẹn, tối đa 5 cột / ≥ 420 px, 14 hàng) với nền, đậm, màu, định dạng số; chữ tràn sang ô trống bên phải như lưới; ô công thức để trống. Slides vẫn dùng `SlideTemplates`. |
| Giao diện | Trang Docs / Sheets: hàng "Start a new document / spreadsheet" (Blank + 6 template) thay cho nút Blank. |
| Test | `apps/web/e2e/templates-flow.mjs` (4 bước): gallery Docs có đủ template và preview; mở Meeting notes → tài liệu có nội dung template (cả bản lưu trên server); gallery Sheets; Invoice → CSV có dòng hàng và "Total due". File tạo trong test bị xoá cuối bài. |

## 45. Chung — Kiểm tra chính tả & ngữ pháp (Docs): quyết định

| Vấn đề | Quyết định |
|---|---|
| Từ điển | Hunspell **en_US** (`dictionary-en`) qua `nspell`, chạy trên **server** (`SpellingService`, nạp lần đầu ~1 s) — không tải 550 KB từ điển xuống trình duyệt. `POST /api/spelling/check {words}` → `{misspelled: {word: gợi ý[]}}`. nspell không bắt lỗi đảo chữ ("teh") và không xếp hạng → server thêm các từ đảo 2 chữ cạnh nhau lên đầu, rồi sắp theo khoảng cách Damerau; tối đa 5 gợi ý, chỉ tính gợi ý cho 60 từ sai đầu tiên mỗi lần (cache theo từ). |
| Từ điển cá nhân | Bảng `user_dictionary(user_id, word)`; `GET/POST/DELETE /api/spelling/dictionary`. Áp dụng cho mọi tài liệu của người đó. Tools → Personal dictionary… để xem / thêm / xoá. |
| Ngữ pháp | Luật trong `doc-model/spelling.ts` (dùng chung, không cần từ điển): lặp từ, a/an (có ngoại lệ "a user", "an hour", bỏ qua viết tắt), viết hoa sau dấu chấm (bỏ qua e.g., Mr., chữ đơn), thừa khoảng trắng, khoảng trắng trước dấu câu. AI grammar để Phase 6. |
| Phạm vi từ | Bỏ qua: đoạn có chữ tiếng Việt / kana / CJK / Hangul (cả đoạn), từ viết hoa toàn bộ (SNS), camelCase (TikTok), URL / e-mail / tên file, từ dính số, code (mark `code`, code block), chữ bị gạch bởi đề xuất. Ngôn ngữ khác ngoài tiếng Anh: chưa (cần thêm từ điển + chọn ngôn ngữ tài liệu). |
| Editor | Plugin `Spellcheck` (`components/docs/spelling.tsx`): gạch sóng đỏ (chính tả) / xanh (ngữ pháp), map vị trí khi gõ, bỏ issue nếu chữ bên trong bị sửa; quét lại 600 ms sau mỗi lần sửa, chỉ hỏi server từ mới. Khi bật gạch chân, plugin đặt `spellcheck="false"` để không trùng với gạch của trình duyệt. Chỉ người có quyền sửa, không chạy ở chế độ Viewing. |
| Giao diện | Tools → Spelling and grammar check (**Ctrl+Alt+X**) hoặc bấm vào chữ bị gạch → thẻ nổi: "Change X to" + các gợi ý, Accept / Ignore (bỏ qua từ đó trong phiên) / Add to dictionary, mũi tên trước-sau, "n of m". Tools → Show spelling and grammar suggestions (bật/tắt, nhớ theo trình duyệt). Accept đi qua transaction thường → có Undo và ghi thành đề xuất ở chế độ Suggesting. |
| Test | `apps/web/e2e/spelling-flow.mjs` (6 bước): API gợi ý (teh→the, recieve→receive); gạch chân khi gõ, đoạn tiếng Việt không bị gạch; Ctrl+Alt+X + Accept sửa hết → câu đúng; bấm từ gạch → Add to dictionary; Ignore; Personal dictionary xoá từ → gạch lại; tắt Show suggestions → hết gạch, trả lại spellcheck của trình duyệt. |

## 46. Phase 3.3 — Macro: trigger & nhập macro: quyết định

| Vấn đề | Quyết định |
|---|---|
| Simple trigger | Giống Apps Script: macro nào khai báo `function onOpen(e)`, `onEdit(e)`, `onSelectionChange(e)` thì tự chạy. Phát hiện bằng cách đọc code (`findTriggers`), không cần đăng ký. Chạy **trong trình duyệt của người mở / người sửa, với tư cách người đó**, cùng sandbox Worker như macro thường (§24) — chỉ editor. |
| Sự kiện `e` | `e.range` (Range thật của API), `e.value`, `e.oldValue` (chỉ khi sửa 1 ô; giá trị cũ lấy ở `BeforeCommandExecute`), `e.source`, `e.user.getEmail()`, `e.triggerUid`, `e.authMode = 'LIMITED'`. |
| Khi nào chạy | `onEdit`: lệnh **cục bộ** set-range-values / clear / delete-range của chính người đó. Thay đổi từ cộng tác viên (`fromCollab`) **không** chạy trigger ở máy mình → mỗi lần sửa trigger chạy đúng một lần, ở máy người sửa. Thay đổi do macro áp (`macroApply`, + 150 ms cho lệnh xong muộn) không bao giờ kích hoạt trigger → trigger ghi vào sheet không lặp vô hạn. `onSelectionChange`: debounce 250 ms, chỉ giữ lần mới nhất. `onOpen`: một lần mỗi lần mở file, chỉ với macro đã có lúc lưới tải xong (tạo macro onOpen giữa phiên không chạy ngay). Hàng đợi tuần tự, tối đa 20 sự kiện. |
| Bật / tắt | Panel Macros → mục **Triggers**: công tắc cho từng trigger; danh sách tắt lưu trong Y.Doc (`macroSettings.disabledTriggers`) → áp cho mọi người. |
| Executions | Mục **Executions (this session)**: mọi lần chạy (thủ công + trigger), trạng thái, thời gian, lỗi; lỗi trigger cũng hiện toast. Chỉ trong phiên (chưa lưu server). |
| Nhập macro | Panel → **Import**: chọn bảng tính khác (cần quyền xem) → `GET /api/resources/:id/macros` (đọc map `macros` từ trạng thái Yjs) → tick macro cần chép; tên trùng thêm "(2)", **không chép phím tắt**. |
| Trigger trên server | Theo lịch và on form submit: xem §48. Executions của simple trigger chưa lưu lâu dài. |
| Test | `apps/web/e2e/macro-triggers-flow.mjs` (6 bước): phát hiện trigger, onOpen không tự chạy khi vừa tạo; onEdit với e.value/e.oldValue/e.user và không tự kích hoạt (đếm E1 = 2 sau 2 lần sửa); Mika sửa → chạy một lần ở máy Mika (E1 = 3); mở lại file → onOpen; tắt công tắc → không chạy; Import sang bảng tính khác. |

## 47. Phase 3.3 — Sheets: màu xen kẽ (alternating colors): quyết định

| Vấn đề | Quyết định |
|---|---|
| Cách làm | Univer OSS không có "banding". Mỗi bộ màu xen kẽ = **các rule conditional format** trên vùng: hàng tiêu đề (`=TRUE`), hai dải (`=ISEVEN/ISODD(ROW()-ROW($A$n))`, neo tuyệt đối vào hàng dữ liệu đầu tiên), hàng chân. Nhờ vậy tự đồng bộ, theo khi chèn/xoá dòng, vào lịch sử phiên bản và **xuất ra Excel** (§29) mà không cần định dạng riêng. |
| Lưu | Map `bandings` trong Y.Doc: `{id, sheetId, header, footer, colors {header, band1, band2, footer}, cf {phần → cfId}}`. **Vùng không lưu**: đọc lại từ hợp các vùng của các rule (rule tự giãn khi chèn dòng). |
| Thao tác | Menu **Format → Alternating colors**: ô chọn nằm trong một bộ màu → mở bộ đó; không thì tạo mới trên vùng chọn (1 ô → vùng dữ liệu), tiêu đề bật, kiểu xanh. Không cho hai bộ chồng nhau. Panel: vùng, Header / Footer, 8 kiểu mặc định (bảng màu Google), màu tuỳ chỉnh (ghi lại sau 250 ms khi kéo), **Remove** (chỉ xoá rule của bộ đó, rule CF khác giữ nguyên). Mọi thay đổi ghi lại toàn bộ rule của bộ. |
| Giới hạn | Chưa đổi vùng bằng ô nhập; màu dải là màu nền CF nên ô có CF khác cùng vùng có thể bị che theo thứ tự ưu tiên của Univer. |
| Test | `apps/web/e2e/sheets-format-flow.mjs` (4 bước): tạo trên vùng dữ liệu (A1:C6, rule đúng màu); footer + kiểu khác, Mika thấy và mở cùng bộ; chèn 2 dòng → A1:C8; Remove chỉ xoá rule của bộ. |

## 48. Phase 3.3 — Macro chạy trên server: trigger theo lịch & khi gửi form: quyết định

| Vấn đề | Quyết định |
|---|---|
| Sandbox | Mã macro do người dùng viết chạy trên server trong **QuickJS biên dịch sang WebAssembly** (`quickjs-emscripten`): engine JS riêng, heap riêng giới hạn **64 MB**, stack 1 MB, **ngắt sau 30 s** (interrupt handler), không có `require` / `process` / mạng / file / timer — chỉ có những gì runtime định nghĩa. Mỗi lần chạy một runtime mới, huỷ ngay sau đó. Không dùng `vm` của Node (không phải ranh giới bảo mật). `isolated-vm` bị loại: không có bản dựng sẵn cho Windows/Node 22, cần bộ build C++ trên mọi máy chủ. |
| Runtime dùng chung | `macroWorker` chuyển sang `packages/sheet-model/src/macro-runtime.ts` (không dùng kiểu DOM, `globalThis` thay `self`): trình duyệt chạy trong Web Worker (§24), server chạy trong QuickJS với shim `self.postMessage`. Một API SpreadsheetApp duy nhất, cùng hành vi. |
| Áp thay đổi | `apps/api/src/sheets/macro-apply.ts`: các thao tác (cells, style, clear, chèn/xoá/ẩn dòng-cột, độ rộng, merge, freeze, màu tab, đổi tên / thêm / xoá sheet) ghi thẳng vào Y.Doc qua `collab.transact` → ai đang mở file thấy ngay như sửa từ xa. Ô công thức: xoá kết quả cache, người mở file tiếp theo tính lại. Thao tác không áp được trên server (border…) ghi vào log, không im lặng. `activate`/`select` bỏ qua. Macro bị ngắt (quá giờ / quá bộ nhớ) → **không áp gì**. |
| Snapshot | Đọc từ trạng thái Yjs (`readWorkbook`, giá trị công thức = kết quả cache cuối cùng); sheet hiển thị đầu tiên là sheet "active". |
| Lưu & lịch | Bảng `macro_triggers` (macro id, hàm, loại `time` / `formSubmit`, lịch, người tạo, bật/tắt, lần chạy kế tiếp, trạng thái/lỗi/log/thời gian lần cuối, số lần lỗi liên tiếp). Lịch: mỗi 1/5/10/15/30 phút, 1/2/4/6/8/12 giờ, mỗi ngày lúc H giờ, mỗi tuần thứ D lúc H (giờ máy chủ). Bộ lập lịch quét mỗi 30 s (`MACRO_SCHEDULER=off` để tắt), **nhận việc bằng cách dời next_run_at trước khi chạy** (cập nhật có điều kiện) → không chạy trùng một lượt. Lỗi 5 lần liên tiếp → tự tắt. |
| Chạy với tư cách ai | Như installable trigger của Apps Script: **người tạo trigger**; mỗi lần chạy kiểm tra người đó còn quyền editor, không thì báo lỗi và không chạy. `e.user` là người tạo. |
| On form submit | Forms nối dòng trả lời vào bảng tính liên kết (`appendRows` giờ trả về sheet + dòng) rồi gọi trigger `formSubmit` của bảng tính đó với `e.values`, `e.namedValues` (tiêu đề cột → [giá trị]), `e.range` (dòng vừa thêm). Không bao giờ chặn việc lưu câu trả lời. |
| API & UI | `GET/POST /api/resources/:id/macro-triggers`, `PATCH /api/macro-triggers/:id {enabled}`, `DELETE`, `POST /api/macro-triggers/:id/run` (Run now). Panel Macros → **Server triggers**: thêm (macro, hàm, Time-driven / On form submit, loại timer + khoảng), Run now, bật/tắt, xoá, trạng thái lần chạy cuối + lần kế tiếp; tự làm mới 20 s. |
| Test | `apps/web/e2e/server-triggers-flow.mjs` (5 bước, ~2 phút): lưu trigger mỗi phút; Run now → lưới đang mở cập nhật, log cho thấy `require`/`process`/`fetch` = undefined; bộ lập lịch tự chạy lần nữa; vòng lặp vô hạn bị dừng sau 30 s, không áp gì; gửi form → trigger ghi vào dòng mới với `e.namedValues`. |

## 49. Phase 3.3 — Sheets: View → Show formulas: quyết định

| Vấn đề | Quyết định |
|---|---|
| Cách làm | Univer OSS không có. Thêm interceptor `CELL_CONTENT` (effect = Value, ưu tiên cao) qua `SheetInterceptorService`: khi bật, ô có công thức hiển thị chuỗi công thức (`t = 1`); công thức dùng chung (`si`) lấy qua `FRange.getFormula()`. Chỉ thay **phần hiển thị** — ô lưu trữ, sửa, xuất file, công thức tính và màn hình người khác không đổi. |
| Phạm vi | Thiết lập **của từng người, từng trình duyệt** (localStorage), giống Google. Menu **View → Show formulas** (dấu ✓) và **Ctrl+`**; nhớ sau khi tải lại (khôi phục lúc dựng lưới, không vẽ lại khi chưa có canvas). |
| Giới hạn | Không tự nới cột như Google; định dạng số của ô giá trị thường vẫn áp (Google hiện số thô). |
| Test | `sheets-format-flow.mjs` (+2): bật → F3 hiện `=SUM(F1:F2)`, F1 vẫn 2, giá trị lưu vẫn 5, Mika vẫn thấy 5; tải lại vẫn bật, Ctrl+` tắt. |

## 50. Phase 3.3 — Sheets: nhóm dòng / cột (outline): quyết định

| Vấn đề | Quyết định |
|---|---|
| Lưu | Map `groups` trong Y.Doc: `{id, sheetId, axis rows/cols, start, end, collapsed}` — `start` / `end` là **id dòng/cột** của layout Yjs (§22) nên nhóm tự đi theo khi chèn / xoá dòng; xoá mất dòng đầu hoặc cuối → nhóm biến mất. Độ sâu lồng tính từ quan hệ chứa nhau (tối đa 8); hai nhóm cắt nhau mà không chứa nhau bị từ chối. |
| Thu gọn | Ẩn dòng/cột qua Univer (`hideRows` / `hideColumns`) → đồng bộ như ẩn thường; trạng thái `collapsed` dùng chung (như Google). Mở nhóm ngoài giữ các nhóm con đang thu gọn. |
| Giao diện | Univer OSS không có outline gutter: `GroupGutter` vẽ overlay DOM (ngoặc + nút +/−, nút ở hàng/cột ngay sau nhóm) trên header, vị trí lấy từ `getCellRect` trừ scroll và nhân zoom, vẽ lại khi cuộn / zoom / đổi cấu trúc. Khi sheet có nhóm, **row header rộng thêm và column header cao thêm** (`setRowHeaderWidth` / `setColumnHeaderHeight`, 16 px + 9 px mỗi cấp) để nút không đè số dòng / chữ cột; mỗi người tự tính giống nhau nên không cần đồng bộ. Hình học đọc lỗi khi dịch vụ render chưa sẵn sàng → thử lại sau 300 ms. |
| Thao tác | Menu **View**: Group rows / Group columns, Ungroup rows / columns (nhóm trong cùng chứa vùng chọn), Expand all / Collapse all row groups. **Alt+Shift+→ / ←** (chọn cả cột → cột, còn lại → dòng). Chỉ editor. |
| Giới hạn | Dòng/cột đóng băng (freeze) chưa được tính khi vẽ; chưa xuất outline sang XLSX (Excel outline level). |
| Test | `sheets-format-flow.mjs` (+3): nhóm dòng 3–5, thu gọn, Mika thấy dòng ẩn và nút +; chèn dòng → nhóm thành 4–6, nhóm lồng 5–5, collapse/expand all; Alt+Shift+← gỡ nhóm trong; nhóm cột C–D ẩn cột. |

## 51. Phase 3.3 — Sheets: filter views: quyết định

| Vấn đề | Quyết định |
|---|---|
| Ý nghĩa | Như Google: bộ lọc **có tên, lưu chung**, nhưng **ai bật thì chỉ màn hình người đó** bị lọc — cộng tác viên, dữ liệu, xuất file không đổi (khác Data → Filter của Univer, vốn áp cho mọi người). |
| Lưu | Map `filterViews` trong Y.Doc: `{id, sheetId, name, r0, r1, c0, c1 (id dòng/cột → theo khi chèn/xoá), hidden: {colId: giá trị bị ẩn}}`. Sửa tiêu chí = sửa view đã lưu (ai dùng view đó cũng thấy tiêu chí mới, như Google). View đang bật là state cục bộ. |
| Lọc | Interceptor `ROW_FILTERED` (cài một lần cho mỗi lưới, `priority: 1000` để chạy **trước** interceptor của plugin filter vốn không chuyển tiếp, rồi tự chuyển tiếp → bộ lọc thường vẫn hoạt động). Tập dòng ẩn tính lại khi dữ liệu đổi (debounce 150 ms) hoặc tiêu chí đổi, rồi `refreshCanvas`. So sánh theo giá trị lưu dạng chữ; ô trống = "(Blanks)". |
| Giao diện | **Data → Create filter view** (vùng chọn / vùng dữ liệu, tên "Filter N"), danh sách view để mở (✓ view đang bật), Close filter view. Thanh tối phía trên lưới (tên, vùng, "only you see this filtering", ×). Panel: đổi tên, vùng, chọn cột, lọc theo giá trị (tìm kiếm, Select all / Clear, đếm), Delete view. |
| Giới hạn | Chưa lọc theo điều kiện (lớn hơn, chứa…), chưa sắp xếp trong view, chưa có link chia sẻ `?fvid=`. |
| Test | `sheets-format-flow.mjs` (+2): tạo view, bỏ 625 → dòng 3,5 ẩn với Claudia, Mika không bị lọc nhưng thấy "Filter 1"; sửa B7 = 625 → ẩn ngay; đóng / mở lại từ menu; xoá view. |

## 52. Phase 4.2 — Slides: bộ hình, xoay, đường tự do: quyết định

| Vấn đề | Quyết định |
|---|---|
| Bộ hình | `slide-model/shapes.ts`: thêm 23 hình theo nhóm như Google — Shapes (octagon, cross, heart, sao 4/6 cánh, cloud, lightning, cylinder), **Arrows** (lên, xuống, hai chiều, notched, pentagon arrow), **Callouts** (chữ nhật, bo góc, oval), **Equation** (+ − × ÷ = ≠). Tên geometry = **tên preset OOXML** (`upArrow`, `wedgeRectCallout`, `mathPlus`…) → xuất PPTX bằng preset gốc và nhập lại 1:1. Đường viền SVG tự vẽ trong `extraShapePath`; callout giữ đuôi trong khung (PowerPoint cho đuôi ra ngoài khung). Bảng chọn Shape chia nhóm, có icon vẽ từ chính `shapePath`. |
| Xoay | Arrange → Rotate: xoay 90° thuận / ngược (làm tròn về bội 90°), lật ngang / dọc, cho cả vùng chọn, một bước undo. |
| Đường tự do | Geometry `freeform` + `path {pts (0…1 trong khung → co giãn theo khung), closed, smooth}`. Toolbar **Line**: Line, Arrow, **Curve** (click từng điểm, Catmull-Rom → Bézier bậc 3), **Polyline** (đoạn thẳng), **Scribble** (kéo chuột, rút gọn điểm bằng Ramer–Douglas–Peucker 1,5 px). Click lại điểm đầu → hình kín (tô màu nhấn); double-click / Enter → kết thúc; Esc → huỷ (bắt ở capture phase để phím tắt của workspace không nuốt mất). `DrawLayer` nằm trong lớp đã scale của slide nên toạ độ là đơn vị slide. Đường hở = nét, không tô, không có chữ (`isOpenStroke`). |
| PPTX | Freeform → `custGeom` (moveTo / lnTo / cubicBezTo / close) qua pptxgenjs `points`. Nhập custGeom từ PowerPoint: chưa (thành hình chữ nhật như trước). |
| Test | `apps/web/e2e/slides-draw-flow.mjs` (5 bước): bảng chọn có Arrows/Callouts/Equation, chèn Heart; xoay 90° → 270°; scribble; polyline đóng + curve kết thúc bằng double-click, Esc huỷ; PPTX có `prst="heart"`, `rot="16200000"`, `custGeom`, `cubicBezTo`, `close`. |

## 53. Phase 4.2 — Slides: liên kết tới slide & tự co chữ: quyết định

| Vấn đề | Quyết định |
|---|---|
| Liên kết | **Insert → Link (Ctrl+K)**, cả khi đang gõ: hộp thoại nhận địa chỉ web hoặc chọn **slide trong bản trình chiếu** (`#slide=<id>` — theo id nên không lệch khi đổi thứ tự slide). Đang sửa chữ → mark `link` trên vùng chọn (không chọn gì thì chèn tiêu đề slide / địa chỉ làm chữ có link); không sửa chữ → trường `link` của **cả phần tử** (hình, ảnh…), như Google. Remove link. `safeHref` cho phép `#slide=`. |
| Trình chiếu | Bấm vào chữ có link hoặc phần tử có `data-link`: link slide → nhảy tới slide đó (bỏ qua nếu slide bị ẩn), link web → tab mới; không bao giờ coi là "slide kế tiếp". |
| PPTX | Link slide → `hlinkClick action="ppaction://hlinksldjump"` (theo số thứ tự slide lúc xuất), cho chữ, hình, freeform; link web như cũ. |
| Text fitting | Format → Text options → **Text fitting**: Do not autofit / **Shrink text on overflow** / **Resize shape to fit text**. Trình soạn đo chữ đã vẽ sau mỗi thay đổi (`useAutofit`, chỉ editor, bỏ qua hộp đang gõ) và **lưu kết quả** vào phần tử: `style.fontScale` (bước 5 %, tối thiểu 30 %, như normAutofit của PowerPoint) hoặc chiều cao mới — nên người xem, trình chiếu, xuất file thấy giống nhau mà không phải đo lại. Chữ thu nhỏ bằng CSS `zoom` trên `.mo-text` (dàn lại dòng, khác transform). Xuống dòng không tuyến tính → nhớ scale đã bị tràn với đúng nội dung/khung đó và không thử lại (tránh dao động 45 % ↔ 50 %, đã gặp "Maximum update depth"). PPTX: `fit: shrink / resize`. |
| Test | `slides-draw-flow.mjs` (+3): Ctrl+K gắn phần tử với Slide 3 → trình chiếu bấm vào → 3/3; shrink → zoom < 1, resize → khung cao hơn 200; PPTX có `hlinksldjump` và autofit. |

## 54. Phase 4.2 — Slides: kiểm tra chính tả cả bản trình chiếu: quyết định

| Vấn đề | Quyết định |
|---|---|
| Phạm vi | **Tools → Spelling and grammar** (Ctrl+Alt+X): panel kiểm tra **mọi hộp chữ của mọi slide** cùng lúc (Google Slides), cùng luật ngữ pháp (doc-model §45), cùng từ điển server và từ điển cá nhân như Docs; Tools → Personal dictionary dùng chung. Quét lại 400 ms sau mỗi thay đổi; cache theo từ cho cả phiên. |
| Danh sách | Mỗi gợi ý: "Slide n · tiêu đề" (bấm → nhảy tới slide và chọn hộp chữ), từ sai + các gợi ý, Accept / Ignore / Add to dictionary. |
| Sửa tại chỗ | `DeckStore.replaceInParagraph(slide, element, đoạn thứ n, from, to, chữ mới)`: đi qua XmlFragment theo đúng thứ tự `readText` (paragraph / heading, kể cả trong list), thay trong `Y.XmlText` **giữ định dạng** của ký tự đầu, một bước undo, đồng bộ cho mọi người. Đoạn đã đổi trong lúc đó → báo "check again". |
| Giới hạn | Chưa gạch chân trong lúc gõ ở Slides; chưa kiểm tra speaker notes và bảng. |
| Test | `slides-draw-flow.mjs` (+1): "Teh team will recieve the the report." → Accept 3 lần → "The team will receive the report.", panel báo hết gợi ý. |

## 55. Phase 4.2 — Slides: Q&A khán giả: quyết định

| Vấn đề | Quyết định |
|---|---|
| Luồng | Như Google Slides (Presenter view ▸ Audience tools): người trình bày bấm **Start new Q&A** trong Presenter view → link ngắn `/qa/<token>` (6 byte ngẫu nhiên, base64url); slide show hiện dải "Ask a question at …" phía trên. Khán giả mở link (không cần tài khoản, trang ngoài app shell) → hỏi (ẩn danh hoặc ghi tên khi đã đăng nhập), upvote / bỏ vote. Presenter view liệt kê theo số vote: **Present** (câu hỏi hiện to trên màn chiếu), **Hide** (ẩn với khán giả, thôi trình chiếu), **Stop** (kết thúc). Một phiên mở cho mỗi bản trình chiếu; Start new kết thúc phiên cũ. |
| Lưu | Bảng `qa_sessions` (resource, token, người bắt đầu, kết thúc, câu đang trình chiếu), `qa_questions` (nội dung ≤ 300 ký tự, tên / ẩn danh, voter, số vote, ẩn), `qa_votes` (khoá chính câu hỏi + voter → mỗi người một vote; vote lại = bỏ vote, trong một transaction). Tối đa 20 câu / người / phiên. |
| Danh tính | Phase 1 gán user mặc định cho request không cookie → trên endpoint khán giả chỉ coi là **đã đăng nhập** khi request có cookie `mo_uid` / header `x-user-id`; còn lại là ẩn danh với id ngẫu nhiên lưu trong localStorage của trình duyệt (để vote một lần). |
| API | Người trình bày (cần quyền với bản trình chiếu): `GET/POST/DELETE /api/resources/:id/qa`, `PATCH /api/qa-questions/:qid {presenting, hidden}`. Khán giả (chỉ cần link): `GET /api/qa/:token`, `POST /api/qa/:token/questions`, `POST /api/qa/:token/questions/:qid/vote`. Phiên đã kết thúc → 403. |
| Cập nhật | Poll 3 s (Presenter view, slide show, trang khán giả) — đủ cho hỏi đáp, không cần kênh realtime công khai. |
| Test | `apps/web/e2e/qa-flow.mjs` (4 bước): F5 + Presenter view → Start → dải link trên slide show; khán giả ẩn danh hỏi, vote / bỏ vote / vote lại, người thứ hai vote → 2; Present → câu hỏi trên màn chiếu, Hide → biến mất cả với khán giả; Stop → dải link biến mất, khán giả thấy "ended", hỏi tiếp → 403. |

## 56. Phase 2.3 — Docs: H5–H6, small caps, thụt lề, đánh số dòng: quyết định

| Vấn đề | Quyết định |
|---|---|
| Heading 5–6 | `heading.levels` 1–6 (toolbar Text style, CSS, DOCX `Heading5/6`, mục lục / outline dùng chung `headingsOf`). |
| Small caps | Mark `smallCaps` (Format → Small caps) → `font-variant:small-caps` trong editor / HTML / PDF, `w:smallCaps` trong DOCX. |
| Thụt lề | Thuộc tính đoạn `indentLeft`, `indentRight`, `firstLine` (pt; **âm = hanging**) qua `ParagraphFormat` → `margin-left/right`, `text-indent` (hanging không có lề trái thì tự lấy lề trái bằng độ treo). Hộp **Format → Indentation options…** như Google: Left / Right / Special (None, First line, Hanging) + By, hiển thị **cm**, lưu pt. DOCX: `w:ind left/right/firstLine/hanging` (twip), cộng với lề của danh sách. |
| Đánh số dòng | **Tools → Line numbers** (lưu trong page setup — chung cho tài liệu). Đánh số **dòng hiển thị** (như Word/Google), không phải đoạn: `lineBoxes()` trong doc-model gom `Range.getClientRects()` theo dòng của từng đoạn / tiêu đề / code (bỏ bảng, chú thích cuối trang, tiêu đề tài liệu); editor vẽ cột số trong lề trái, đo lại khi sửa / đổi cỡ / tải font (chia cho zoom). **PDF**: cùng hàm được nhúng vào trang (script) và chạy trong Chromium với layout in (media print, bề rộng = khổ giấy trừ lề) trước khi in. **DOCX**: `w:lnNumType` liên tục. Đánh số liên tục cả tài liệu ở mọi nơi (chưa có "bắt đầu lại mỗi trang"). |
| Test | `apps/web/e2e/docs-format-flow.mjs` (4 bước): Heading 5, small caps; first line 1,5 cm → `text-indent:42.5pt`, hanging; line numbers ≥ 6, số cuối = số dòng, nằm trong lề; DOCX có Heading5, smallCaps, `w:hanging="850"`, `lnNumType`, HTML có script đánh số, PDF xuất được. |

## 57. Phase 2.3 — Docs: chip placeholder & sự kiện lịch: quyết định

| Vấn đề | Quyết định |
|---|---|
| Placeholder chip | Node inline `placeholderChip {label}` hiện `[label]` viền nét đứt (dùng cho template). Bấm → ô "Replace placeholder with": gõ giá trị + Enter → chip được **thay bằng chữ thường** ngay tại chỗ; đổi tên placeholder; Remove. Xuất HTML/PDF/DOCX/text: `[label]`. |
| Event chip | Node `eventChip {title, date, start, end, location}` hiện "📅 Title · Oct 5, 2026, 10:00–10:30". Bấm → sửa tiêu đề, ngày, giờ bắt đầu/kết thúc, địa điểm; **Add to calendar** = tải file `.ics` (iCalendar: giờ "floating" theo giờ máy, không có giờ → sự kiện cả ngày). Chưa liên kết module Calendar (chưa có) — khi có sẽ trỏ tới sự kiện thật. Xuất: chữ "📅 …". |
| Chèn | Menu `/` (Smart chips: Placeholder, Calendar event) và `@` (placeholder, event / meeting / calendar). |
| Test | `docs-format-flow.mjs` (+2): `/placeholder` → điền "Acme Corp" → thành chữ; `/event` → đổi tiêu đề / địa điểm → nhãn đổi, `.ics` có VEVENT, SUMMARY, LOCATION, giờ 10:00; DOCX có cả hai. |

## 58. Phase 2.3 — Docs: trích dẫn (citations): quyết định

| Vấn đề | Quyết định |
|---|---|
| Lưu | Nguồn và kiểu trích dẫn trong settings map của tài liệu (`citations: {style, sources[]}`) → đồng bộ, vào lịch sử phiên bản. Nguồn: loại (Book / Website / Journal article), tác giả (họ, tên), tiêu đề, nhà xuất bản / tên website / tạp chí, năm, volume / issue / pages, URL. |
| Kiểu | `doc-model/citations.ts`: **APA 7**, **MLA 9**, **Chicago author-date** — trích dẫn trong câu "(Tanaka, 2024, p. 12)" / "(Tanaka 12)" / "(Tanaka 2024, 12)", 2 tác giả & / and, ≥3 et al.; danh mục tài liệu (References / Works Cited / Bibliography) theo đúng thứ tự tên, **in nghiêng** tên sách / website / tạp chí, thụt treo, không tác giả → tiêu đề lên đầu. |
| Node | `citation {sourceId, page}` (inline) và `bibliography` (block) — chữ hiển thị tính từ nguồn + kiểu nên **đổi kiểu là mọi trích dẫn và danh mục đổi theo**; node view đọc settings qua React context (`CitationsProvider` quanh `EditorContent`). Danh mục chỉ liệt kê nguồn **đã được trích**, chưa trích nguồn nào thì liệt kê tất cả; tự cập nhật khi thêm / xoá trích dẫn. |
| Xuất | `resolveCitations()` thay node bằng chữ / tiêu đề + đoạn (thụt treo, in nghiêng) trước khi xuất → DOCX, PDF, HTML, text đều đúng mà không exporter nào phải biết citations. |
| Giao diện | **Tools → Citations**: chọn kiểu, Add citation source (form theo loại), danh sách nguồn với **Cite** (chèn tại con trỏ), Edit, Delete, **Insert bibliography** (một lần, cuối tài liệu). Bấm trích dẫn → thêm số trang / Remove. |
| Test | `docs-format-flow.mjs` (+2): sách + website không tác giả, Cite → "(Tanaka, 2024)", trang 12 → "(Tanaka, 2024, p. 12)", danh mục "References" chỉ có sách; đổi MLA → "(Tanaka 12)", "Works Cited"; DOCX có chữ đã định dạng và tên sách in nghiêng. |

## 59. Phase 2.3 — Docs: ngắt section & hướng trang theo section: quyết định

| Vấn đề | Quyết định |
|---|---|
| Node | `sectionBreak {orientation}` (block): nội dung **sau** nó là section mới bắt đầu ở trang mới, theo hướng của nó (ví dụ một bảng ngang trong báo cáo dọc). Section đầu theo Page setup. `sectionsOf(doc, first)` chia nội dung cấp cao nhất thành các section — dùng chung cho các bộ xuất. |
| PDF / HTML | `toHTML` để lại dấu `<!--mo-section:…-->`; `toHTMLDocument` bọc từng phần trong `<section style="page:portrait|landscape">` với **CSS named pages** (`@page portrait` / `@page landscape`, cùng lề) — Chromium in mỗi section đúng khổ, section sau luôn sang trang. Footnote, đánh số tiêu đề, đánh số dòng không bị tách. |
| DOCX | Mỗi section là một **Word section** (`w:sectPr` riêng, `w:orient`), cùng lề, header/footer, đánh số dòng; tiêu đề tài liệu ở section đầu. |
| Editor | Thanh "Section break (next page)" có nút **Portrait ⇄ Landscape**; chèn từ Insert (hướng ngược với tài liệu) hoặc `/section break`. Màn hình soạn **không** đổi bề rộng trang cho section ngang (giới hạn: chỉ PDF / Word hiển thị khổ ngang). |
| Test | `docs-format-flow.mjs` (+1): chèn → landscape, đổi qua lại; DOCX ≥ 2 `sectPr` có `orient="landscape"`; HTML có named pages; PDF có cả trang dọc lẫn trang ngang (MediaBox). |

## 60. Phase 2.3 — Docs: hình vẽ (Insert → Drawing): quyết định

| Vấn đề | Quyết định |
|---|---|
| Mô hình | Node block `drawing {w, h, elements}`: `elements` là **PlainElement của slide-model** (hình, đường, freeform, hộp chữ) — một "slide nhỏ" nằm trong tài liệu. doc-model không phụ thuộc slide-model: bộ vẽ được truyền vào (`renderDrawing`, như biểu đồ). |
| Soạn | Insert → **Drawing…** / double-click / nút Edit → hộp thoại dùng **chính canvas của Slides** (`SlideCanvas` + `DeckStore`) trên một deck một slide tạm (Y.Doc riêng, undo riêng): Shape (mọi hình kể cả bộ hình mới), Line (line, arrow, curve, polyline, scribble), Text, Fill, Border, xoá, undo/redo; hình mới xếp so le 20 px. Esc kết thúc gõ chữ / công cụ vẽ trước khi đóng hộp thoại (bắt ở capture phase trước Radix). **Save and close** ghi lại `elements` vào node (một bước, đồng bộ cho mọi người). |
| Hiển thị | Node view vẽ bằng `slideHtml` (cùng renderer với Slides), co theo bề rộng chữ, giữ tỉ lệ. |
| Xuất | HTML / PDF: chèn HTML của slide, co bằng `zoom` vào ~600 px; DOCX: chụp PNG trong Chromium (`drawing:<n>`, giống biểu đồ). |
| Giới hạn | Chưa chèn ảnh vào hình vẽ; chưa có drawing dùng chung giữa tài liệu (Google Drawings riêng). |
| Test | `docs-format-flow.mjs` (+2): heart + scribble + hộp chữ → lưu → xem trước có hình và chữ; mở lại có 3 phần tử, xoá hộp chữ → lưu → còn hình; DOCX có ảnh PNG, HTML có `<figure class="drawing">` với SVG. |

## 61. Phase 8.1 — Forms: QR code & nhập câu hỏi từ form khác: quyết định

| Vấn đề | Quyết định |
|---|---|
| QR | Send → **QR code** của link trả lời: thư viện `qrcode` vẽ SVG ngay trong trình duyệt (mức sửa lỗi M), **Download PNG** 1024 px cho poster / slide. Không cần server. |
| Nhập câu hỏi | Nút **Import questions** trên thanh công cụ nổi → chọn form (gần đây hoặc tìm kiếm, chỉ form mình mở được) → tick mục cần lấy (mặc định mọi mục trừ section) → chèn sau mục đang chọn, **một bước undo**. Định nghĩa đọc qua `GET /forms/:id/definition` (quyền **viewer** — cùng điều kiện với việc đồng bộ Y.Doc của form, nên kèm đáp án quiz như Google). |
| Nhân bản | `importItems` (form-model): id mới cho mục và lựa chọn; rẽ nhánh tới section được nhập theo section mới, tới section không nhập → "section kế tiếp"; `submit` giữ nguyên. Đáp án, điểm, validation đi kèm. |
| Test | `forms.mjs` (+2): definition có đáp án cho người mở được form, 404 cho người không mở được. |

## 62. Phase 8.1 — Forms: e-mail thông báo & bản sao cho người trả lời: quyết định

| Vấn đề | Quyết định |
|---|---|
| Hạ tầng mail | `MailService` (module chung, tiền thân của module Mail): mọi thư **ghi vào `mail_outbox`** trước (kind, to, subject, text, html, resource, status), rồi gửi SMTP nếu có `SMTP_URL` (`nodemailer`); không có thì chỉ ghi (`logged`). Gửi lỗi → `failed` + lỗi, **không bao giờ** làm hỏng thao tác gốc (gửi sau khi câu trả lời đã lưu, `void`). Dev: `docker compose --profile mail up -d` → Mailpit (SMTP :1025, hộp thư :8025). Thư HTML theo màu theme của form + bản text. |
| Thông báo câu trả lời mới | Theo **từng người** như Google ("Get email notifications for new responses"): bảng `form_subscriptions (form, user)`, nút chuông trong tab Responses. Mỗi câu trả lời mới → một thư cho mỗi người đăng ký **còn quyền editor** (kiểm lại lúc gửi): ai trả lời, tổng số câu trả lời, điểm, từng câu, nút "View responses" (`/forms/:id?tab=responses`). `settings.notify` cũ bỏ không dùng. |
| Bản sao cho người trả lời | Setting **Send responders a copy**: Off / When requested (ô "Send me a copy of my responses" ở trang cuối) / Always — cần thu thập email (verified hoặc tự nhập). Thư có mọi câu trả lời, điểm chỉ khi người trả lời được phép thấy (release ngay hoặc đã release), link sửa nếu cho sửa. Sửa câu trả lời cũng gửi lại bản sao. |
| Outbox | `GET /forms/:id/outbox` (editor): 50 thư gần nhất của form — để kiểm tra / hỗ trợ, và là dữ liệu module Mail sẽ hiển thị. |
| Giới hạn | Chưa có hàng đợi / thử lại cho thư lỗi; chưa gom thư (digest) khi form nhận rất nhiều câu trả lời; link trong thư dùng `WEB_ORIGIN`. |
| Test | `forms.mjs` (+5): đăng ký (editor được, respondent không), thư cho người đăng ký, bản sao khi yêu cầu, outbox chỉ cho editor, tắt thông báo thì không gửi nữa. |

## 63. Phase 8.1 — Forms: chấm điểm tay & công bố điểm: quyết định

| Vấn đề | Quyết định |
|---|---|
| Lưu | `form_responses.grades jsonb {itemId: {points?, feedback?}}` + `released_at`. Điểm tổng vẫn lưu ở `score` (CSV / Sheets / trung bình dùng như cũ), tính lại mỗi lần chấm bằng `scoreOf(form, answers, grades)`. |
| Quy tắc điểm | `pointsFor`: điểm người chấm (0…điểm tối đa) **ghi đè** đáp án tự động; để trống = đáp án quyết định; câu có điểm mà không có đáp án (tự luận) = 0 cho tới khi chấm (`ungraded` → "Needs grading", "N responses to grade"). Sửa câu trả lời: giữ điểm chấm tay của câu **không đổi**, bỏ của câu đã đổi. |
| Giao diện | Tab Responses → Individual: mỗi câu có điểm một ô "x / max" (placeholder = điểm tự động, ô vàng khi cần chấm) + phản hồi; lưu khi rời ô (`PATCH /forms/:id/responses/:rid/grades`), cập nhật live cho người khác qua stateless `responses`. Viền xanh/đỏ theo điểm chấm. |
| Công bố | Release score = **Later**: nút "Release scores (N)" (tất cả chưa công bố) và "Release score" từng người (`POST /forms/:id/release`) → đặt `released_at`, gửi thư "Your score" có link **View score**; công bố lại không gửi trùng. |
| View score | `/f/:id?result=<token>` (token riêng của câu trả lời — người có link là người trả lời): trước khi công bố chỉ báo "chưa công bố" (không lộ gì); sau đó: tổng điểm, điểm từng câu, phản hồi của người chấm (hoặc phản hồi đúng/sai soạn sẵn), đáp án đúng nếu bật "Respondents can see correct answers". Biên nhận sau khi gửi có link "View score" khi điểm chưa hiện ngay. Form gửi kèm vẫn qua `publicForm` (không đáp án). |
| Giới hạn | Chưa chấm theo câu (Question view) hàng loạt; điểm mới không cập nhật ngược vào dòng đã ghi trong bảng tính liên kết; chưa có phản hồi chung cho cả bài. |
| Test | `forms.mjs` (+14): tự luận 0 điểm tới khi chấm, chấm + phản hồi, ghi đè và xoá ghi đè, vượt tối đa / câu không điểm / respondent bị từ chối, release + thư, release lần hai = 0, View score trước/sau công bố, không lộ đáp án, sửa câu trả lời giữ điểm chấm. |

## 64. Phase 5 — Chat lõi & kênh realtime: quyết định

| Vấn đề | Quyết định |
|---|---|
| Loại hội thoại | Một bảng `conversations` với `kind`: **dm** (hai người — hoặc một người: "ghi chú cho mình"; `dm_key` = workspace + hai user id đã sắp xếp, unique → mỗi cặp chỉ một DM, ai mở trước cũng vậy), **group** (nhiều người, tên tuỳ chọn — không tên thì ghép tên thành viên), **channel** (tên bắt buộc, `public` / `private`, có thể gắn Space). |
| Thành viên & quyền | `conversation_members (role owner/admin/member, last_read_seq, pinned, muted)`. Kênh: owner/admin đổi tên, mô tả, công khai/riêng tư, xoá người, phong admin; thành viên mời người. Nhóm: ai cũng đổi tên. DM không có thành viên để sửa. Owner rời đi → người vào sớm nhất thành owner. Kênh public: ai trong workspace cũng **xem trước** (đọc lịch sử, không gửi) rồi Join; kênh private / DM / nhóm của người khác → 404. |
| Tin nhắn | `messages (seq, sender, kind text/system, body, mentions uuid[], thread_root_id, reply_count, last_reply_at, edited_at, deleted_at)`. `seq` tăng dần **theo hội thoại**, lấy bằng `UPDATE conversations SET last_seq = last_seq + 1 … RETURNING` trong cùng transaction (khoá dòng → không trùng, không hở). Nội dung là văn bản + Markdown nhẹ (`**đậm**`, `_nghiêng_`, `~~gạch~~`, `` `code` ``, khối ```, link tự nhận) — render thành React node, không bao giờ HTML. |
| Mention | Lưu dạng token `<@user-uuid>` (đổi tên người dùng không làm hỏng tin cũ); `mentions` được server tính lại từ nội dung (chỉ người trong workspace). Composer hiện "@Tên" và giữ bảng tên→id của các mention đã chọn, đổi lại thành token khi gửi / sửa. Mention chính mình tô vàng. |
| Chưa đọc | Một số nguyên mỗi thành viên: `last_read_seq`. Unread = tin **gốc** (không tính trả lời thread), loại text, chưa xoá, không phải của mình, `seq > last_read_seq`; Mentions = trong số đó có nhắc mình. Gửi tin = đã đọc tới tin đó. Marker chỉ tiến, không vượt `last_seq`. Thành viên mới / người Join bắt đầu ở `last_seq` (thấy lịch sử, không bị tính chưa đọc). Badge sidebar = tổng unread của hội thoại không tắt tiếng. |
| Đã xem | Kênh/nhóm: avatar mỗi thành viên nằm dưới tin cuối cùng họ đã đọc (chỉ ở cuối cuộc trò chuyện). DM: "Sent" / "Seen" dưới tin cuối của mình. Cập nhật live bằng sự kiện `chat.read`. |
| Thread | Trả lời một tin gốc (`thread_root_id`; không lồng thread). Tin gốc giữ `reply_count`, `last_reply_at`, 3 người trả lời gần nhất; panel Thread bên phải. Xoá tin gốc giữ chỗ ("This message was deleted") và thread. |
| Sửa / xoá / reaction | Chỉ người gửi sửa; người gửi hoặc admin kênh xoá (xoá mềm: mất nội dung + reaction, giữ seq/thread). Reaction: bật/tắt mỗi (tin, người, emoji), tối đa 20 emoji khác nhau / tin; trả về `userIds` để mỗi client tự tính "của tôi" khi nhận qua socket. Tin hệ thống (tạo kênh, join, rời, thêm/xoá người, đổi tên, đổi chế độ) không sửa/xoá được. |
| Kênh realtime | **Một WebSocket mỗi tab**: `ws://<api>/realtime?token=` (gắn vào HTTP server của API bằng `ws`, `noServer`), token HMAC 60 giây lấy qua `GET /realtime/token` (đi qua proxy Next, nên cookie danh tính dùng được). Dùng chung cho mọi app (chat bây giờ, thông báo sau). Server: `publish(userIds, event)`; sự kiện `chat.message`, `chat.message.updated`, `chat.read`, `chat.typing`, `chat.conversation`, `presence`. Client: `RealtimeBridge` trong shell, cập nhật thẳng cache TanStack Query; mất kết nối → thử lại (1s→15s) và refetch mọi query chat khi nối lại. Ping 30 giây dọn socket chết. Một process: Redis fan-out của §1 thay vào sau `publish()` khi API chạy nhiều instance. |
| Đang gõ / online | Client gửi `{type:'typing'}` tối đa mỗi 2,5 giây; server kiểm tra thành viên (cache 60 giây) rồi chuyển cho người khác; hiển thị 4,5 giây hoặc tới khi người đó gửi tin. Presence = có socket đang mở, chỉ phát trong cùng workspace; chấm xanh ở DM, "Active now / Away". |
| Gửi lạc quan | Tin tạm `tmp-…` (mờ, "Sending…") thay bằng tin thật khi API trả về hoặc khi socket tới trước (khử trùng theo id / nội dung). |
| Giao diện | `/chat` và `/chat/:id` (theo "over view 2.png"): cột danh sách (tìm kiếm — gồm cả người chưa có DM, tab All/Unread/Mentions/Favorites, mục Pinned, đang gõ thay preview, menu ghim/tắt tiếng/đánh dấu đã đọc/rời), khung hội thoại (header: avatar, thành viên, tìm kiếm, ghim, tắt tiếng, chi tiết; mốc ngày dính; vạch **New**; gộp tin liên tiếp trong 5 phút; bong bóng của mình bên phải; thanh hover: 4 reaction nhanh, emoji, trả lời thread, sửa/sao chép/xoá; tải trang cũ khi cuộn lên mà giữ nguyên vị trí; nút "New messages" khi đang đọc tin cũ), panel phải Thread / Details (đổi tên, mô tả, riêng tư, thành viên & vai trò, thêm người) / Search. Composer: Enter gửi, Shift+Enter xuống dòng, ↑ sửa tin cuối, Esc huỷ, Ctrl+B/I, @gợi ý, emoji. Home có thẻ **Recent Chats**; Hero có "Start a new chat". |
| Giới hạn (đợt sau) | Thẻ tài liệu & gửi file, ghim tin nhắn (đợt 2); thông báo/chuông (đợt 3); Contacts & hồ sơ (đợt 4); chưa có thông báo đẩy trình duyệt, chưa có hàng đợi offline cho tin chưa gửi, tìm kiếm trong hội thoại dùng `ILIKE` (OpenSearch ở Phase 6). |
| Test | `chat.mjs` (67): danh sách & unread/mention từ seed, DM/nhóm/kênh, lịch sử, reaction, thread, socket (presence, token giả bị từ chối, tin nhắn chỉ tới thành viên, read receipt, typing — kể cả chặn người ngoài), sửa/xoá/quyền, tìm kiếm, tạo DM một lần mỗi cặp, ghi chú cho mình, xem trước & join kênh public, đổi tên / riêng tư / vai trò / xoá người / chuyển owner, ghim & tắt tiếng theo người. `chat-flow.mjs` (14, hai trình duyệt): badge danh sách & sidebar, vạch New, tin + đang gõ live, mention, Markdown, reaction, thread, ↑ sửa, xoá, DM mới + Seen, tạo kênh + duyệt + join, ghim, Home. |

## 65. Phase 5 — Chat: thẻ tài liệu, gửi file, ghim tin: quyết định

| Vấn đề | Quyết định |
|---|---|
| Tham chiếu, không sao chép | `message_refs (message, resource, position, source attachment/link)` — tin nhắn chỉ trỏ tới resource (P1, §10); xoá tin chỉ bỏ tham chiếu, file vẫn ở Drive. Tối đa 10 file / tin. Tin có thể chỉ có file (nội dung rỗng). |
| Nguồn file | **Share from Drive** (gần đây / tìm kiếm), **Upload from computer**, dán (Ctrl+V) hoặc kéo-thả vào khung chat. File tải lên vào thư mục **"Chat files"** trong My Files của người gửi (`POST /chat/upload-folder`, tạo một lần, `metadata.chatFiles`). **Link** tới file trong nội dung (bất kỳ URL chứa id của resource mà người gửi mở được) thành thẻ (unfurl, `source: link`); link tới thứ người gửi không mở được giữ là chữ. Sửa tin: tính lại link, giữ đính kèm. |
| Thẻ file | Siêu dữ liệu **live** lúc đọc (tên, loại, kích thước, chủ sở hữu, trong thùng rác) — đổi tên trong Drive thì thẻ đổi theo; bấm → `hrefFor` mở đúng editor. **Theo quyền người xem** (P5): ai không mở được thấy thẻ khoá "Restricted file", không tên, không chủ sở hữu. Vì vậy tin có file được serialize **riêng cho từng người nhận** khi đẩy qua socket (tin không file vẫn một payload chung). |
| Hỏi cấp quyền (§6.4) | Gửi file mà có thành viên không mở được → **409 `needs_access`** liệt kê từng file: ai thiếu quyền, người gửi có chia sẻ được không (cần quyền admin/owner trên file). Hộp thoại "Share before sending?": **Share and send** (Viewer / Commenter / Editor → tạo ACL cho đúng những người thiếu, ghi `acl.changed` với `via: chat`), **Send without sharing** (`grant: none`), hoặc huỷ. Không chia sẻ được → chỉ còn gửi không chia sẻ; cố `grant` → 403. Chưa gửi gì khi đang hỏi. File vừa **tải lên** để gửi thì tự cấp Viewer (không hỏi). |
| Tab trong hội thoại | **Chat · Files · Pinned** (theo ảnh tham chiếu). Files: mỗi file một lần, mới nhất trước, người gửi + thời gian (bỏ tin đã xoá). Pinned: tin được ghim (ai trong hội thoại cũng ghim / bỏ ghim được, tối đa 50), "Pinned by …" trên tin, tin hệ thống "pinned a message". Danh sách hội thoại hiện "📎 File" cho tin chỉ có file. |
| Giao diện | Composer: nút **+** (Upload / Share from Drive), chip file (đang tải / sẵn sàng / bỏ), Enter gửi khi file đã tải xong; focus quay lại ô nhập sau khi chọn file. Nhãn ngày dính theo từng ngày (mỗi ngày một `section`, không chồng nhãn). |
| Giới hạn | Chưa có xem trước ảnh / video ngay trong tin (thẻ mở trình xem); chưa có "Request access" từ thẻ khoá; file tải lên luôn vào My Files (chưa vào thư mục của Space gắn với kênh). |
| Test | `chat.mjs` (+24 → 91): thẻ live theo quyền, 409 + không gửi khi đang hỏi, share-and-send cấp Viewer, gửi lại không hỏi, tin chỉ có file, kênh liệt kê mọi người thiếu quyền, gửi không chia sẻ, payload socket theo từng người, không chia sẻ được → 403, file không mở được → 404, unfurl link (và bỏ qua link không mở được), tab Files + xoá tin, thư mục Chat files tạo một lần, ghim/bỏ ghim/quyền. `chat-flow.mjs` (+5 → 19): thẻ mở editor, Send without sharing → thẻ khoá, Share and send → mở được, tải file từ máy + tab Files, ghim + tab Pinned. |

## 66. Phase 5 — Thông báo (chuông): quyết định

| Vấn đề | Quyết định |
|---|---|
| Lưu | `notifications (user, kind, actor, resource?, conversation?, message?, title, body, url, read_at)` — một dòng mỗi người mỗi sự kiện, tiêu đề/nội dung viết sẵn lúc tạo (danh sách không phải join lại), `url` là đường dẫn trong app (`resourcePath` = bản server của `hrefFor`). Không bao giờ báo cho chính người làm. Ghi **sau** khi thay đổi đã commit; lỗi ghi thông báo không làm hỏng thao tác gốc. |
| Nguồn | **chat.mention** — bị @nhắc trong hội thoại mình là thành viên (kể cả trong thread; người ngoài hội thoại không được báo); **chat.reply** — trả lời trong thread mình mở đầu hoặc đã trả lời (trừ người đã nhận mention của cùng tin); **resource.shared** — được chia sẻ file ("You can view / comment on / edit it", không báo khi bị gỡ quyền); **comment.created** — bình luận mới trên file mình sở hữu; **comment.reply** — trả lời trong luồng bình luận mình tham gia (chỉ người còn mở được file). Tin thường trong kênh không tạo thông báo (đã có badge chưa đọc của Chat). |
| Đã đọc | Bấm một mục, hoặc **Mark all as read** (`POST /notifications/read {ids | 'all'}` — chỉ đụng tới thông báo của chính mình). Đọc trong Chat cũng đọc chuông: cuộn qua tin có mention (read marker vượt seq của tin) và mở thread (mọi thông báo của tin gốc + trả lời). Mọi thay đổi đẩy `notification.read` để tab khác cập nhật badge. |
| Realtime | Cùng socket §64: sự kiện `notification` (thêm vào đầu danh sách, badge +1) và `notification.read`. Toast nhỏ có nút **Open** khi thông báo tới — trừ khi đang ở đúng trang nó trỏ tới. |
| Giao diện | Chuông trên top bar với badge đỏ; popover: All / Unread / Mentions, avatar người làm + biểu tượng loại, tiêu đề, trích đoạn, "x mins ago", chấm xanh chưa đọc. Link `/chat/:id?thread=<tin gốc>` mở panel thread bên cạnh hội thoại. |
| Giới hạn | Chưa có thông báo đẩy của trình duyệt / e-mail tổng hợp, chưa có cài đặt bật/tắt theo loại, chưa gom nhiều trả lời thành một mục; Forms (thư báo câu trả lời) vẫn đi qua e-mail §62. |
| Test | `notifications.mjs` (22): mention live + nội dung dùng tên, tự nhắc / người ngoài không bị báo, trả lời thread (người mở đầu, mọi người trong thread), tin thường không báo, đọc hội thoại đọc mention (và báo tab khác), thread chỉ đọc khi mở, chia sẻ / gỡ quyền, bình luận mới / trả lời / bình luận trên file của mình, đánh dấu đọc (của người khác = 0, một mục, tất cả, bộ lọc chưa đọc). `notifications-flow.mjs` (5): badge + toast, mở mention → hội thoại và hết badge, link trả lời mở thread, file được chia sẻ mở editor, Mark all as read. |

## 67. Phase 5 — Contacts & hồ sơ người dùng: quyết định

| Vấn đề | Quyết định |
|---|---|
| Dữ liệu | Thêm vào `users`: `phone`, `location`, `status` (dòng trạng thái dưới tên), `skills text[]`, `manager_id` (quản lý trực tiếp); `workspace_members.joined_at` (ngày vào). "Projects" = các **Space** người đó là thành viên — không có bảng riêng. |
| Ai thấy gì | Mọi người trong workspace thấy thẻ của nhau (tên, chức danh, phòng ban, liên hệ, kỹ năng, quản lý). Những gì nói về công việc thì **lọc theo quyền người xem**: Projects chỉ gồm Space người xem thấy được; tab Files = file người đó sở hữu mà người xem mở được (`ResourcesService.toDtos`); tab Activity = sự kiện do người đó làm mà người xem được thấy (`visibleActivity`, dùng chung với Recent Activity ở Home). |
| Tìm kiếm | Một ô tìm cho tên, e-mail, chức danh, phòng ban, nơi làm, kỹ năng và tên Space; nhóm theo **Department / Skills / Project** (một người có thể ở nhiều nhóm kỹ năng / dự án). |
| Sửa hồ sơ | Ai cũng sửa **thông tin liên hệ của mình** (trạng thái, điện thoại, nơi làm, kỹ năng — cắt khoảng trắng, bỏ trùng, tối đa 20). Chức danh, phòng ban và quản lý là **của tổ chức**: chỉ chủ workspace sửa (cho mọi người); quản lý phải trong workspace, không phải chính mình, không tạo vòng lặp báo cáo. |
| Sơ đồ tổ chức | Tab Organization: chuỗi quản lý từ trên xuống, người đang xem (tô xanh), cấp dưới trực tiếp; bấm để đi tới hồ sơ khác. |
| Giao diện | `/contacts` và `/contacts/:id` (theo "over view 2.png" ô 2–3): danh bạ (ô tìm, tab All / Department / Skills / Project, dòng: avatar + chấm online, tên, chức danh · phòng ban, kỹ năng, nút **Chat**, menu xem hồ sơ / chép e-mail) bên cạnh hồ sơ (ảnh bìa theo màu người dùng, avatar lớn + online, trạng thái, Chat / Video call (chờ Meetings, Phase 7) / E-mail / Edit profile, tab Overview · Organization · Files · Activity). Menu người dùng → **Profile**; hồ sơ trong DM có **View profile**. |
| Giới hạn | Chưa có ảnh đại diện / ảnh bìa tải lên, chưa có khách bên ngoài (External, ô 7 của ảnh), chưa có danh bạ nhiều workspace / đồng bộ từ SSO-HR. |
| Test | `contacts.mjs` (26): danh bạ, chi tiết liên hệ, tìm theo kỹ năng / phòng ban / Space / nơi làm, Projects lọc theo quyền, quản lý / chuỗi / cấp dưới, file của người đó lọc theo quyền, activity của người đó, 404, cờ sửa, tự sửa (cắt, bỏ trùng, xoá trường), không tự đổi chức danh / không sửa người khác, chủ workspace đổi chức danh / phòng ban / quản lý, chặn vòng lặp / tự quản lý / người ngoài. `contacts-flow.mjs` (7): tìm kỹ năng, nhóm phòng ban / dự án, trường hồ sơ, sơ đồ tổ chức + Files, Chat từ hồ sơ, View profile từ DM, tự sửa hồ sơ từ menu người dùng. |

## 68. Phase 5 — Chat theo mô hình Discord: Space, kênh, vai trò, file trong nhóm: quyết định

Yêu cầu (2026-10-06): chat phải theo workspace và nhóm, file đính kèm nằm trong workspace và nhóm, phân quyền rõ ràng — "làm theo cách Discord". Thay phần phạm vi/quyền của §64–§65.

| Vấn đề | Quyết định |
|---|---|
| Cấu trúc | **Space = server của Discord.** Mọi **kênh** thuộc đúng một Space (bắt buộc `space_id`), xếp theo **category** (`channel_categories`, thứ tự `position`). **DM và nhóm DM** (tối đa **10 người**, như Discord) ở cấp workspace, ngoài mọi Space. Không còn kênh "trôi nổi" hay duyệt kênh toàn workspace. |
| Ai thấy kênh | Kênh **public**: mọi người thấy được Space (vai trò ≥ viewer — kể cả người xem qua Space công khai) — không cần Join; hàng `conversation_members` được tạo tự động (đã đọc hết) khi danh sách được tải, khi vào Space, hoặc khi kênh trở lại public. Kênh **private**: chỉ người được thêm (phải thấy được Space) và **admin/owner của Space** (như Administrator của Discord). Người ngoài → 404. Không rời / không thêm người vào kênh public (rời Space hoặc tắt tiếng); kênh private: admin thêm/xoá, ai cũng tự rời. |
| Quyền = vai trò trong Space (như role Discord) | **viewer**: đọc. **commenter**: gửi tin, reaction. **editor**: + gửi / tải file. **admin / owner** của Space (hoặc owner/admin của kênh): tạo kênh & category, đổi tên/mô tả/riêng tư/thông báo, thêm/xoá người, xoá tin người khác, ghim tin. **Kênh thông báo** (`post_policy = admins`): chỉ admin đăng, mọi người đọc + reaction. Trong DM/nhóm: thành viên gửi tin, file, ghim; chủ nhóm quản lý thành viên. API trả `perms {post, attach, react, moderate, manage}` cho từng hội thoại; giao diện ẩn ô nhập (banner "chỉ đọc" / "chỉ admin đăng"), nút đính kèm, reaction, ghim theo đó. Typing chỉ nhận từ người được gửi tin. |
| File trong nhóm | File tải lên trong kênh nằm **trong Space**: `Chat files / #tên-kênh` ở gốc Space (thuộc chủ Space — người rời kênh không giữ quyền nhờ "người tải lên đầu tiên"). Kênh public → quyền theo vai trò Space. Kênh private → thư mục **restricted**: cờ `metadata.restricted` khiến thư mục và mọi thứ bên trong **không thừa hưởng vai trò Space** (`PermissionsService.rolesFor`), chỉ mở qua ACL = đúng thành viên kênh (editor nếu được gửi file, viewer nếu không), đồng bộ khi thêm/xoá người, đổi chế độ, đổi vai trò hay rời Space. DM/nhóm → thư mục riêng của cuộc trò chuyện dưới "Chat files" của người bắt đầu, ACL cho mọi thành viên (kể cả chủ thư mục — sở hữu thư mục không mở file người khác bỏ vào), chuyển chủ khi chủ cũ rời nhóm. `POST /chat/conversations/:id/upload-folder` (cần quyền gửi file). |
| File có sẵn trong Drive | **Chat không bao giờ cấp quyền** (bỏ "Share and send" của §65; `grant` khác `none` → 400). Ai có quyền đọc file thì xem, có quyền sửa thì sửa; người không có quyền thấy thẻ khoá. Gửi file mà có người không mở được → 409 chỉ để báo trước ("họ sẽ thấy bị khoá") với **Send anyway**. Muốn cho họ quyền: chia sẻ từ Drive, hoặc tải bản vào thư mục của hội thoại. Gửi file Drive cũng cần quyền gửi file (editor). |
| Đồng bộ với Space | `SpacesService.setMember` gọi `ChatService.spaceMembershipChanged`: vào Space → có mặt trong mọi kênh public; rời Space / mất quyền → ra khỏi kênh không còn thấy và mất ACL thư mục file; đổi vai trò → cập nhật quyền tải file trong thư mục restricted. Mention trong kênh báo cho mọi người **đọc được** kênh (không phụ thuộc đã mở hay chưa); người ngoài kênh private không bao giờ được báo. |
| Giao diện | Theo Discord: **thanh Space** bên trái (Home = tin nhắn trực tiếp, mỗi Space một ô, chấm chưa đọc + số mention), cột kênh theo category (mở/đóng; `#` public, ổ khoá private, loa = thông báo; đậm khi chưa đọc, `@n` khi có mention), menu Space cho admin (Create channel, Create category), dòng "Your role: … · read only / can write, no files". Bấm vào Space mở kênh đầu tiên. Header ghi Space · số thành viên · Public/Private/Announcements. Hộp thoại kênh mới: tên, mô tả, category, public/private, kênh thông báo, thành viên (private). Nhóm DM: chọn tối đa 9 người. |
| Giới hạn | Chưa có override quyền theo từng kênh/role tuỳ chỉnh (Discord permission overwrites), chưa kéo-thả sắp xếp kênh/category (API có `position`), chưa có kênh thoại / thread dạng forum. (Đã sửa: lỗi hydration thỉnh thoảng gặp — trang Chat/Mail nằm trong Suspense vì `useSearchParams` nên hydrate muộn, khi thanh bên đã nạp dữ liệu vào cache dùng chung; nay chỉ render sau khi mount, `useMounted`.) |
| Test | `chat.mjs` (112): ngoài các mục cũ — kênh cần Space, chỉ admin tạo kênh / category, kênh public gồm cả Space không cần Join, quyền editor / owner / viewer / commenter, Space không được thấy thì ẩn, không rời / không thêm vào kênh public, đổi tên, kênh thông báo (thành viên không đăng, admin đăng, vẫn reaction), commenter không gửi file / không có thư mục upload, chỉ admin xoá tin người khác & ghim trong kênh, kênh private (ẩn với phần còn lại của Space, admin Space thấy, người ngoài Space không thêm được, admin thêm/xoá/phong), thư mục file trong Space, thư mục kênh private chỉ mở cho thành viên, rời Space → mất kênh private + thư mục, vào lại → có kênh public, DM: thư mục chỉ hai người, file người này tải lên người kia mở được, chat không cấp quyền (400), gửi anyway không cấp quyền, ghim trong DM. `chat-flow.mjs` (19) viết lại cho bố cục Discord. |

## 69. Module Mail: hộp thư của workspace & hộp thư chung của Space: quyết định

Yêu cầu (2026-10-06): làm module Mail — hộp thư theo domain của workspace (người dùng chọn), có hộp thư chung theo Space theo quyền Space (người dùng chọn).

| Vấn đề | Quyết định |
|---|---|
| Hộp thư | `mailboxes (kind user / space, address unique, name, signature)`. Mỗi người một hộp thư, tạo khi dùng lần đầu, địa chỉ trên domain của workspace (`workspaces.mail_domain`, seed `hanami.example`; mặc định `<slug>.local`). Mỗi Space **một** hộp thư chung tuỳ chọn (vd. `marketing@hanami.example`), do admin Space bật; địa chỉ không trùng. |
| Lưu thư | Thư lưu **một lần** (`mail_messages`: Message-ID RFC, In-Reply-To, References, from, to/cc/bcc, subject, text, html chỉ cho thư từ ngoài, author, external, status draft/sent). Mỗi hộp thư giữ thư bằng một `mail_items` (direction in/out, folder inbox/sent/drafts/archive/trash, read, starred) nằm trong **thread của riêng hộp thư đó** (`mail_threads`, gom theo References / In-Reply-To; người được giao xử lý cho hộp thư chung). Gửi cho chính mình = một item out (Sent) + một item in (Inbox), hiện một lần. |
| Gửi | Địa chỉ có hộp thư trong hệ thống → **giao ngay** vào Inbox (kể cả hộp thư chung). Địa chỉ khác → SMTP qua `MailService` (ghi `mail_outbox` trước; From = địa chỉ hộp thư, Message-ID/In-Reply-To/References, Cc/Bcc, file đính kèm, envelope chỉ gồm địa chỉ ngoài). Không có `SMTP_URL` thì chỉ ghi lại (dev: Mailpit). Bcc chỉ hiện với hộp thư gửi. Trả lời: chỉ được trả lời thư có trong hộp thư mình; tiêu đề "Re:", tham chiếu tối đa 20. |
| File đính kèm | Như email thật: **bản sao** (`mail_attachments`: blob + tên), không phải liên kết. Tải lên trước khi gửi (`POST /mail/attachments`, chỉ người tải dùng được); file Drive có blob được chép kèm, tài liệu soạn trong app (Docs/Sheets/…) đi dưới dạng **link** (người nhận mở bằng quyền của họ — mail không cấp quyền). Tải về: ai đọc được một hộp thư có thư đó. **Save to Drive** tạo file trong My Files. |
| Quyền | Hộp thư cá nhân: chỉ chủ. Hộp thư chung theo vai trò Space: viewer/commenter **đọc**, editor **gửi, trả lời, đánh dấu, chuyển thư mục, giao việc**, admin **cài đặt**. Giao việc chỉ cho người được gửi từ hộp thư (editor+). Người ngoài Space riêng tư không thấy hộp thư (404). |
| Thư mục & thao tác | Inbox, Starred, Sent, Drafts, Archive, Trash, All (tìm kiếm). Đọc / chưa đọc, gắn sao, lưu trữ (chỉ thư nhận), thùng rác (cả thread), khôi phục (thư nhận về Inbox, thư gửi về Sent, nháp về Drafts), xoá vĩnh viễn chỉ từ thùng rác và chỉ trong hộp thư đó (người khác vẫn giữ). Nháp tự lưu (1,5 giây sau khi gõ), mở lại để sửa, gửi nháp = chuyển sang Sent + giao, bỏ nháp. |
| Realtime | `mail.changed` (danh sách/đếm) cho mọi người thấy hộp thư; `mail.received` → toast "New mail from …" (nút Open) khi không ở trang Mail. Badge chưa đọc trên sidebar = thread chưa đọc trong Inbox cá nhân. |
| Giao diện | `/mail?box=&folder=&t=`: cột hộp thư (Compose, "My mailbox" + thư mục + số đếm, "Shared mailboxes" + thiết lập cho admin Space, ghi chú "Read only" theo vai trò), danh sách thread (người gửi, số thư, tiêu đề, trích đoạn, file, sao, người được giao, nút nhanh lưu trữ/xoá/đọc/sao), khung đọc (thư cũ đã đọc thu gọn, trích dẫn "> …" gập lại, HTML từ ngoài trong **iframe sandbox** không chạy script, nhãn EXTERNAL, "by <tác giả>" cho thư gửi từ hộp thư chung, file với Tải về / Save to Drive, Reply / Reply all / Forward, Assign). Cửa sổ soạn nổi kiểu Gmail: From (hộp thư gửi được), To/Cc/Bcc dạng chip có gợi ý (người, hộp thư chung, địa chỉ ngoài đã từng viết), đính kèm (máy / Drive / kéo thả), Ctrl+Enter gửi, thu nhỏ / phóng to. |
| Giới hạn (đợt sau) | Chưa **nhận thư từ ngoài** (cổng SMTP vào / webhook MIME — cần thêm thư viện phân tích MIME); thư từ ngoài trong seed được tạo trực tiếp. Chưa có nhãn tuỳ chỉnh, lọc tự động, hẹn giờ gửi, chữ ký tự chèn, soạn thảo rich text; file Drive chọn trong nháp chỉ giữ khi gửi ngay (nháp chỉ lưu file đã tải lên). |
| Test | `mail.mjs` (58): hộp thư & domain, hộp thư chung trong danh sách, inbox theo thời gian, thread gom trả lời + file, HTML chỉ cho thư ngoài, người khác không mở được, giao nội bộ + realtime, Sent, trả lời gom thread hai phía, không trả lời thư không thuộc mình, Bcc (giao được, chỉ người gửi thấy), gửi cho mình, địa chỉ ngoài qua SMTP, địa chỉ sai / thiếu người nhận / gửi từ hộp thư người khác, file (tải lên, người khác không dùng được, file Drive chép, tài liệu thành link, tải về, người ngoài không tải được, Save to Drive, file không mở được bị từ chối), đọc / sao / lưu trữ (Sent giữ thư mình) / xoá cần thùng rác / khôi phục / xoá vĩnh viễn chỉ ở hộp thư mình, nháp (lưu, không giao, gửi nháp, bỏ), hộp thư chung (đọc, commenter chỉ đọc, editor trả lời từ địa chỉ chung ra ngoài, tác giả, giao việc đúng người, hộp cá nhân không giao, thư nội bộ tới địa chỉ chung), bật hộp thư Space (chỉ admin, trùng địa chỉ, người ngoài không thấy), tìm kiếm, sổ địa chỉ. `mail-flow.mjs` (9, ba trình duyệt). |

## 70. Module Mail: nhận thư từ bên ngoài: quyết định

| Vấn đề | Quyết định |
|---|---|
| Hai cổng vào | **Cổng SMTP** trong API (`smtp-server`, `MAIL_INBOUND_PORT`, mặc định 2525, 0 = tắt): chỉ nhận RCPT cho địa chỉ **có hộp thư** ở đây (khác → 550), tối đa 25 MB (552), lỗi lưu → 451 để bên gửi thử lại. Chạy SMTP thường trên cổng riêng (tắt AUTH/STARTTLS) — production đặt MTA hoặc dịch vụ email phía trước lo TLS/MX/chống spam. **Webhook** `POST /mail/inbound` nhận MIME thô (Mailgun/SES/SendGrid "raw"), header `x-inbound-secret` = `MAIL_INBOUND_SECRET` (so sánh hằng thời gian; không đặt → tắt, trả 404), `x-envelope-to` tuỳ chọn. |
| Phân tích | `mailparser` (charset, multipart, file đính kèm). Người nhận = envelope (SMTP / header webhook), không có thì To + Cc có hộp thư ở đây. HTML bỏ `<script>` và thuộc tính `on…`, rồi còn được hiển thị trong iframe sandbox. File (trừ ảnh nhúng cid) thành blob + `mail_attachments`. Thời gian hiển thị = **lúc nhận** (header Date chỉ chính xác tới giây, theo đồng hồ người gửi). |
| Thread & trùng | Gom vào thread của từng hộp thư bằng In-Reply-To / References — thư đối tác trả lời thư mình gửi ra ngoài nằm cùng cuộc trò chuyện. Cùng Message-ID tới lần nữa (gửi lại, webhook gọi lại) → không nhân đôi. Một thư gửi cho cả hộp thư chung lẫn người → vào cả hai. |
| Giới hạn | Chưa lọc spam / SPF / DKIM / DMARC (để MTA phía trước làm), chưa xử lý thư báo lỗi gửi (bounce), chưa tải ảnh từ xa có kiểm soát. |
| Test | `mail-inbound.mjs` (12): SMTP nhận thư cho địa chỉ của mình, vào Inbox chưa đọc có file, đánh dấu thư ngoài + người gửi, HTML không còn script/onerror, tải file, trả lời ra ngoài rồi thư đáp lại gom đúng thread, địa chỉ không có hộp thư bị 550, thư tới hộp thư chung + bản cho người, webhook sai khoá 404, webhook lưu MIME, gửi trùng chỉ lưu một lần. |

## 71. Phase 7 — Calendar: quyết định

Theo "giao diện calender.png".

| Vấn đề | Quyết định |
|---|---|
| Lịch | `calendars (kind user / space)`: mỗi người **My Calendar** (tạo khi dùng lần đầu); mỗi Space một **lịch nhóm** tuỳ chọn do admin Space bật (`POST /calendar/spaces/:id/calendar`). Quyền như Mail: lịch cá nhân chỉ chủ; lịch nhóm theo vai trò Space — viewer/commenter **xem**, editor **thêm/sửa**, admin cài đặt. Space riêng tư → người ngoài không thấy lịch. |
| Sự kiện | `calendar_events`: loại Event / Focus time / Out of office, tiêu đề, mô tả, địa điểm, start/end (instant), cả ngày (nửa đêm → nửa đêm theo múi giờ của sự kiện, end không tính), **múi giờ IANA**, lặp lại `{freq daily/weekly/monthly/yearly, interval, byDay, until, count}` + `exdates` (bỏ một lần), link họp (Office Meet tự tạo / Google Meet / Zoom / Teams / link riêng), riêng tư, người tổ chức, file Drive (id — hiện theo quyền người xem), `sequence` (iCalendar). Sửa áp cho cả chuỗi; xoá "This event" (exdate) hoặc "All events". |
| Lặp lại & múi giờ | Không thư viện: `zonedToUtc` / `zonedParts` / `tzOffsetMinutes` (Intl) trong `@workos/shared`. Chuỗi được mở rộng **theo giờ địa phương của sự kiện** (09:00 vẫn là 09:00 khi đổi giờ mùa hè), nhảy thẳng tới gần khoảng cần xem (chuỗi hằng ngày nhiều năm vẫn nhanh), tối đa 1000 bước; hằng tháng ngày 31 chỉ rơi vào tháng có ngày 31; 29/2 chỉ năm nhuận. `GET /calendar/events?from&to` tối đa 120 ngày. |
| Khách mời | `event_attendees`: người trong workspace (`user_id`) hoặc địa chỉ ngoài; Pending / Accepted / Tentative / Declined, tuỳ chọn. Người tổ chức là khách đã "Yes". Khách **thấy sự kiện dù nó nằm trong lịch người khác**, trả lời Yes / Maybe / No (`POST /events/:id/respond`) → người tổ chức nhận chuông. |
| Lời mời | Tạo / sửa / huỷ (khi `notify`) → chuông `calendar.invite` cho người trong workspace + **thư từ hộp thư của người tổ chức** (Mail §69: nội bộ giao ngay, ngoài qua SMTP) có lời nhắn, thời gian, địa điểm, link họp, link trả lời, và tệp **.ics** (METHOD:REQUEST / CANCEL, UID, SEQUENCE, ORGANIZER, ATTENDEE PARTSTAT, RRULE) để Google Calendar / Outlook nhận. Gửi thư lỗi không làm hỏng sự kiện. |
| Bận / rảnh | Bảng People: chọn người để xem lịch của họ bên cạnh lịch mình — chỉ thấy **"Busy"** (không tiêu đề, địa điểm, khách, link) trừ sự kiện mình được mời hoặc lịch mình đọc được. Sự kiện riêng tư chỉ chủ lịch và khách thấy chi tiết. |
| Giao diện | `/calendar?view=&date=&event=`: thanh trên (←/→, Today, khoảng ngày, Day / Week / Month / Agenda, Create event), cột trái (lịch tháng nhỏ, tìm người, People có chấm online, My calendars / Team calendars bật-tắt theo màu, "view" cho lịch chỉ xem), lưới giờ (GMT±, hàng cả ngày, vạch giờ hiện tại, xếp sự kiện chồng nhau thành cột, bấm ô trống → tạo sự kiện đúng giờ đó, khách Pending viền đứt, Declined gạch ngang, bận = sọc xám), tháng (tối đa 3 + "+n more"), agenda 30 ngày, panel chi tiết (loại, thời gian, múi giờ, lặp lại, **Join meeting** + chép link, trả lời, lịch, địa điểm, khách theo trạng thái, mô tả, file; sửa / xoá — hỏi một lần hay cả chuỗi). Hộp thoại sự kiện như ảnh tham chiếu (tab Event/Focus time/Out of office, ngày giờ, cả ngày, múi giờ, lặp lại, địa điểm, link họp + nhà cung cấp, khách có gợi ý, gửi lời mời + lời nhắn, chọn lịch, mô tả, file từ Drive). Link `/calendar?event=` (từ chuông, thư) mở đúng sự kiện. Home **Upcoming**: sự kiện còn lại hôm nay, "Now", nút Join. |
| Sửa thêm | Lời chào ở Home tính theo giờ của server → lệch HTML khi trình duyệt khác múi giờ; nay tính sau khi mount. |
| Giới hạn | Phòng họp video thật đến cùng module Meetings (link Office Meet hiện mở trang Meetings); chưa kéo-thả để dời/kéo dài sự kiện; chưa sửa riêng một lần của chuỗi (chỉ xoá); chưa đồng bộ Google / Outlook hai chiều, chưa nhận phản hồi .ics từ ngoài; chưa nhắc trước giờ họp. |
| Test | `calendar.mjs` (36): lịch + lịch nhóm theo Space, lịch Space riêng tư bị ẩn, commenter chỉ xem, sự kiện hằng tuần mỗi tuần một lần đúng giờ Tokyo, khách + trả lời + link họp + file, sự kiện lịch nhóm, khách thấy sự kiện ở lịch người khác, người không được mời 404, bận/rảnh không lộ chi tiết (trừ sự kiện được mời), trả lời + chuông cho người tổ chức, chỉ khách được trả lời, tạo với khách + link, chuông + thư + .ics hợp lệ, người tổ chức "Yes", quyền thêm vào lịch nhóm / lịch người khác, end trước start, múi giờ lạ, cả ngày, >120 ngày, hằng tháng ngày 31, dời + đổi khách + báo thay đổi, khách không sửa được, xoá một lần của chuỗi, huỷ + báo, bật lịch nhóm (chỉ admin, một lịch mỗi Space). `calendar-flow.mjs` (10). |

## 72. Phase 7 — Tasks: quyết định

Theo "over view.png" (Kanban, Gantt, thống kê).

| Vấn đề | Quyết định |
|---|---|
| Dự án | `projects (space_id, name, key unique trong workspace, color, statuses jsonb, created_by)`. Dự án **nằm trong Space** và theo vai trò Space như Chat / Mail / Calendar: viewer **xem**, commenter **bình luận**, editor **tạo / sửa / kéo thả task**, admin hoặc người tạo dự án **đổi cột & cài đặt**. Space riêng tư → người ngoài không thấy dự án (404). Editor của Space tạo dự án. |
| Cột (status) | Mặc định To Do / In Progress / Review / Done; mỗi cột `{id, name, color, category todo/doing/done}`. Đổi cột: cột bị xoá → task chuyển về cột đầu; luôn phải còn một cột "done". Vào cột done → `completed_at` + progress 100; ra khỏi → mở lại. |
| Task | `tasks`: số thứ tự theo dự án (**WEB-12**, bộ đếm trong `projects`), tiêu đề, mô tả, status, priority urgent/high/medium/low/none, người được giao (chỉ người **thấy dự án**), tags (bỏ trùng), start/due (due không trước start), progress, **subtask một cấp** (cùng dự án; tiến độ cha = tỉ lệ subtask xong), `position` cho thứ tự cột. **Task cá nhân** (không dự án): chỉ người tạo và người được giao thấy. |
| Thứ tự trên bảng | Vị trí phân số base-62 (`between(a, b)` trong `@workos/shared`): thả giữa hai thẻ → chỉ dòng được kéo thay đổi. Web tính cùng khoá đó khi thả nên thẻ nằm đúng chỗ ngay, rồi lấy kết quả từ server. |
| Hoạt động & thông báo | `task_events`: tạo, thay đổi (giá trị cũ → mới của từng trường), bình luận. Giao task → chuông `task.assigned`; bình luận → `task.comment` cho người được giao và người tạo. Realtime `tasks.changed` tới **mọi người đọc được Space** (`PermissionsService.spaceReaders`: Space công khai = cả workspace; riêng tư = thành viên + chủ workspace) — cũng dùng cho lịch nhóm (§71) vốn trước chưa báo cho thành viên Space. |
| Thống kê | `GET /tasks/projects/:id/stats` (task cấp cao nhất): tỉ lệ hoàn thành, đúng hạn, thời gian chu kỳ trung bình (tạo → xong), quá hạn, số theo cột, 30 ngày tạo / xong, theo người (giao, xong, đúng hạn). |
| Giao diện | `/tasks?project=&view=&task=`: chọn **My tasks** (task cá nhân + được giao cho mình, ba cột; task dự án có cột khác xếp theo trạng thái) hoặc dự án theo Space (số xong/tổng), **New project**. **Board** (cột theo dự án, thẻ: tags, ưu tiên, hạn — quá hạn đỏ, subtask, bình luận, mã, người; kéo thả có vạch vị trí, "+ Add task" theo cột; viewer chỉ xem). **List** (nhóm theo cột, đổi status tại chỗ). **Gantt** (bảng trái cố định khi cuộn ngang: phase → bước, gập/mở, start/due/progress — phase lấy **trung bình tiến độ các bước**; thanh theo màu cột phần đã làm đậm, cuối tuần tô nền, vạch **Today**, mở ra đúng hôm nay). **Calendar** (tháng theo ngày hạn). **Dashboard** (5 ô số, đường Created / Completed một trục có crosshair + tooltip + bảng số, cột theo status, hiệu suất từng người; màu kiểm bằng validator của skill dataviz). Ô tìm (tiêu đề / mã / tag), lọc người. **Drawer** bên phải: sửa mọi trường tại chỗ, subtask tick ngay, tags, mô tả, hoạt động + bình luận, xoá. |
| Giới hạn | Chưa kéo thanh Gantt để dời ngày, chưa phụ thuộc giữa task (finish-to-start), chưa trường tuỳ chỉnh, chưa task lặp lại, chưa đính kèm file (dùng link Drive trong mô tả), chưa giao nhiều người. |
| Test | `tasks.mjs` (30): dự án theo Space + số đếm, mã + tiến độ subtask, thứ tự thẻ, viewer chỉ xem / tạo bị từ chối, editor tạo (số kế tiếp, cột đầu, tags không trùng), chuông giao việc, due trước start, thả giữa hai thẻ, vào/ra cột done, lịch sử thay đổi, subtask (cùng dự án, không lồng, tiến độ cha), bình luận báo người giao + người tạo, viewer không bình luận, tạo dự án + key trùng, chỉ giao cho người thấy dự án, dự án riêng tư bị ẩn, đổi cột (thành viên không được, chủ dự án được, task cột bị xoá chuyển về cột đầu, phải còn cột done), My tasks, task cá nhân của người khác 404, ai cũng có task cá nhân, thống kê, xoá. `tasks-flow.mjs` (12, hai trình duyệt): chọn dự án, viewer chỉ xem, tạo task mở drawer, kéo sang In Progress lên đầu cột + người khác thấy ngay + còn sau khi tải lại, drawer (subtask, giao, bình luận, hoạt động), đổi status ở List, tìm, Gantt (tiến độ phase, Today, gập phase, mở task), lịch theo hạn, dashboard (ô số, tooltip, người, bảng), My tasks + task mới, dự án mới. `calendar-flow.mjs` nay chạy được sau `test:calendar` (bỏ qua câu trả lời / lần lặp mà test API đã đổi). |

## 73. Phase 7 — Meetings (họp video): quyết định

Theo "over view 2.png" ô 4 (Gọi video / Họp trực tuyến) và mục Meetings trong "giao diện work.png".

| Vấn đề | Quyết định |
|---|---|
| Kết nối | **WebRTC mesh**: mỗi trình duyệt nối thẳng tới từng người còn lại, tối đa `MEETING_MAX_PEERS` = 8 tab trong một phòng (đủ cho họp nhóm; SFU như LiveKit / mediasoup là bước sau nếu cần phòng lớn). API **chỉ chuyển tín hiệu** (offer / answer / ICE) qua socket realtime có sẵn (§64, tin `meeting.signal` từ client — server kiểm tra người gửi đúng là chủ peer đó và người nhận đang trong phòng). Thương lượng theo mẫu **perfect negotiation** (bên "polite" nhường khi hai bên cùng offer), người mới vào gọi những người đã có mặt. STUN / TURN lấy từ `MEETING_ICE_SERVERS` (JSON); để trống = chỉ kết nối trực tiếp (cùng máy / LAN) — họp qua Internet cần TURN. |
| Phòng | `meetings (code abc-defg-hij duy nhất, title, host, conversation_id, event_id, access open/trusted, notes_id, started_at, ended_at)`. Mã sinh bằng `meetingCode(randomBytes(10))` trong `@workos/shared` — Calendar (§71) và seed dùng chung, link Office Meet cũ vẫn hợp lệ (`MEETING_CODE` nhận cả chữ số). Ai đang ở trong phòng (peer = một tab, có `peerId` ngẫu nhiên) giữ **trong bộ nhớ** của API, giống socket realtime (một tiến trình). `meeting_participants` lưu lịch sử (vào lần đầu / cuối, tổng số giây), vai trò (host / cohost / guest) và trạng thái (joined / admitted / removed). |
| Ai vào thẳng | Host, co-host; **open** = mọi người trong workspace; **trusted** = người phòng được tạo cho: thành viên đọc được cuộc trò chuyện của phòng (§68), khách của sự kiện lịch, người tạo, người đã từng vào / đã được cho vào. Còn lại **xin vào** → sảnh chờ; host / co-host đang trong phòng (không có ai trong số đó thì bất kỳ ai trong phòng) **Admit / Deny**. Bị Remove → phải xin lại. Phòng tạo ngay = open; gọi từ Chat và link từ lịch = trusted. Host đổi được trong More → Host controls. |
| Từ Calendar | Link Office Meet của sự kiện **tạo phòng ở lần mở đầu tiên** (`GET /meetings/:code` tìm sự kiện có `meeting_url` chứa mã): tiêu đề sự kiện (riêng tư → "Private meeting"), host = người tổ chức, trusted. Nút Join trong Calendar / Home / Meetings mở phòng ngay trong app. `/calendar?create=1` mở hộp tạo sự kiện (Meetings → Schedule in Calendar). |
| Từ Chat | Nút **Video call** (DM / nhóm) hay **Start a meeting** (kênh, cần quyền gửi tin) trên header: một cuộc gọi mỗi cuộc trò chuyện — gọi lại khi đang có cuộc gọi thì vào cuộc đó. Tin "📹 Started a video meeting: link" hiện thành **thẻ cuộc họp** sống (đang diễn ra + ai trong phòng + Join, hoặc "Ended · 23 min", bản ghi, ghi chú); mọi link phòng trong tin nhắn đều có thẻ. DM / nhóm: người kia **đổ chuông** (`meeting.ring` → hộp Incoming video call góc phải, Join / Decline, tự tắt sau ~40 s; vào từ máy khác thì máy này thôi đổ chuông). Không ai bắt máy → chuông thông báo **"Missed video call from …"** (`meeting.call`). Hồ sơ Contacts: **Video call** = gọi trong DM với người đó. |
| Trước khi vào | Xem trước camera (lật gương), bật / tắt mic & camera, chọn thiết bị; ai đang trong phòng; Join now / Ask to join (đang chờ… / bị từ chối); phòng đầy. Tắt camera là **dừng hẳn thiết bị** (đèn tắt); bật lại thì thêm track (thương lượng lại) hoặc `replaceTrack`. |
| Trong phòng | Giao diện tối như ảnh tham chiếu: thanh trên (logo, tiêu đề, giờ, **Recording…**, chi tiết, rời), lưới ô (video hoặc avatar, tên + Host / Co-host, mic tắt, giơ tay, **viền xanh người đang nói** — đo âm lượng bằng Web Audio), một mình thì thẻ "You're the only one here" + link. **Chia sẻ màn hình** (`getDisplayMedia`, thêm track riêng; người xem nhận ra nhờ `screen = stream id`) → màn hình chiếm sân khấu, các ô xếp cột bên phải. Thanh dưới: Mic, Camera, Share, Record (host / co-host), Notes, React (👍👏😂❤️🎉😮 bay lên), Raise hand, Chat (số chưa đọc), Participants (số người, số người chờ), More (chép link, Host controls: chế độ vào, **End meeting for everyone**), Leave. Bảng People: người chờ (Admit / Deny), người trong phòng; host / co-host: Mute (yêu cầu trình duyệt kia tắt mic), Make co-host (chỉ host), Remove. Chat trong cuộc họp lưu ở `meeting_messages` (chỉ người đang trong phòng gửi). |
| Giữ kết nối | Mỗi 10 s `POST /meetings/:code/alive`; tab im quá 35 s bị đưa ra khỏi phòng; nếu server không còn nhận ra tab (mạng rớt lâu) → tab tự vào lại. Đóng trang → `navigator.sendBeacon(leave)`. Người cuối rời → `ended_at`, phòng dùng lại được (lần sau là phiên mới). |
| Ghi hình | Host / co-host bấm Record → mọi người thấy biển **Recording…** (một người ghi mỗi lúc). Trình duyệt người ghi vẽ bố cục phòng lên canvas 15 hình/s (màn hình chia sẻ, hoặc lưới ô + tên) và trộn mọi giọng nói (Web Audio) → **MediaRecorder WebM** → `POST /meetings/:code/recordings` → video trong thư mục **"Meeting recordings"** ở My Files của người ghi, **người đã tham gia được quyền xem** (+ chuông), tin báo trong cuộc trò chuyện của phòng (chat không cấp quyền — §68). |
| Ghi chú | Notes → tài liệu từ template Meeting notes (tạo lần đầu, dùng lại về sau), mọi người đã / đang trong phòng là editor, mở ở tab mới; link ở trang Meetings, thẻ chat, màn hình sau cuộc họp. "AI Notes" / tóm tắt đến cùng Phase 6. |
| Trang `/meetings` | New meeting (họp ngay / tạo link để dùng sau / lên lịch trong Calendar), ô nhập mã hoặc link; **Coming up** (sự kiện có link họp trong 7 ngày, Join); **Your meetings** (đã host / tham gia: giờ, thời lượng, người, bản ghi, ghi chú, đang diễn ra → Join). `/meetings?room=` = phòng; mã sai → "Check your meeting code". Seed: 3 cuộc họp đã qua. |
| Sửa thêm | Home → Upcoming: ngày hiển thị theo múi giờ trình duyệt sau khi mount (trước lệch HTML khi trình duyệt khác múi giờ server). |
| Giới hạn | Mesh ≤ 8 người; không có TURN mặc định; người ngoài workspace (khách không đăng nhập) chưa vào được; chưa phụ đề / AI tóm tắt (Phase 6), chưa phòng nhỏ (breakout), chưa nền ảo; trạng thái phòng mất khi API khởi động lại (các tab tự vào lại). |
| Test | `meetings.mjs` (73): tạo phòng, open vào thẳng, mã sai, vào / danh sách người, phát tín hiệu chỉ tới đúng peer và không giả được peer người khác, mic / tay / reaction (chỉ bộ cố định), chat trong phòng, trusted + sảnh chờ (host thấy, khách không duyệt được, admit / deny / huỷ chờ), mute / co-host / remove (phải xin lại), phòng tối đa 8, ghi hình (một người một lúc, video vào Drive đúng thư mục, người tham gia xem được, người ngoài không, chuông), ghi chú (một tài liệu, editor, người ngoài không), rời / kết thúc / lịch sử / dùng lại / end for everyone, gọi từ DM (đổ chuông, link trong chat, thành viên vào thẳng, gọi lại = cùng cuộc gọi, từ chối, cuộc gọi nhỡ), link Office Meet từ lịch (host = người tổ chức, khách vào thẳng, người khác xin vào). `meetings-flow.mjs` (15, Chromium với camera / mic giả, **video WebRTC thật hai chiều**): xem trước, tắt / bật camera, vào một mình, người thứ hai vào, mute / giơ tay / reaction, chat + số chưa đọc, sảnh chờ + admit, host mute, chia sẻ màn hình, ghi hình → Drive, ghi chú mở tab mới, rời, end for everyone + lịch sử có bản ghi, gọi từ DM đổ chuông → bắt máy, Video call từ hồ sơ. |

## 74. Phase 7 — Approvals (phê duyệt): quyết định

Theo mô hình Lark Approval: mẫu phê duyệt (form + quy trình) do quản trị thiết kế, nhân viên gửi yêu cầu, người duyệt xử lý lần lượt từng bước.

| Vấn đề | Quyết định |
|---|---|
| Mẫu (template) | `approval_templates`: tên, mô tả, nhóm (HR / Finance / Operations / General…), icon + màu, **form** (`fields` JSON: chữ ngắn, đoạn văn, số + đơn vị, tiền + loại tiền, ngày, **khoảng ngày**, chọn một, chọn nhiều, người, tệp đính kèm; bắt buộc hay không), **quy trình** (`steps` JSON), admin riêng của mẫu, bật / tắt, việc làm thêm khi được duyệt. Chủ / admin workspace tạo, sửa, xoá mẫu; **admin của mẫu** (ví dụ HR với Nghỉ phép, Finance với Hoàn ứng) sửa mẫu đó và xem mọi yêu cầu của nó. Mẫu đã có yêu cầu không xoá được (409) — tắt đi. |
| Bước | Mỗi bước: **Duyệt** hoặc **CC** (chỉ báo). Người duyệt: người cụ thể; **quản lý trực tiếp** hoặc **quản lý cấp 2** của người gửi (tuyến báo cáo `users.manager_id` của Contacts §67); **người gửi tự chọn** khi gửi; hoặc người trong một trường "người" của form. Nhiều người: **một người duyệt là đủ** (or — những người còn lại thành "skipped") hoặc **tất cả phải duyệt** (and). **Điều kiện** tuỳ chọn trên một câu trả lời (>, ≥, <, ≤, =, ≠, thuộc) — trên khoảng ngày thì so **số ngày** (nghỉ > 3 ngày → thêm HR). Hàm `approvalConditionHolds` / `approvalValueText` / `rangeDays` ở `@workos/shared`, server và web dùng chung. |
| Gửi | Kiểm tra từng câu trả lời theo loại (bắt buộc, lựa chọn trong danh sách, ngày hợp lệ, khoảng ngày không ngược, người trong workspace, tệp phải là **tệp chính người gửi tải lên** — vào thư mục "Approval attachments" trong My Files). **Tuyến được tính một lần khi gửi** và lưu cùng bản sao form (`fields`, `route`) — sửa mẫu sau đó không làm đổi yêu cầu đang chạy. Bước không thoả điều kiện → bỏ qua ("Condition not met"); không có quản lý → bỏ qua ("No manager on file"); bước "tự chọn" chưa chọn người → 400. Số thứ tự **AP-00001** theo workspace (advisory lock). Trong form có **xem trước quy trình trực tiếp** (`POST /approvals/templates/:id/preview`) — đổi khoảng ngày thì bước HR hiện / ẩn ngay. |
| Chạy | `approval_tasks` (một dòng / người / bước: waiting → pending → approved / rejected / transferred / skipped, hoặc cc). Bước mở lần lượt: CC được gửi rồi đi tiếp; bước duyệt chờ đủ người (or / and). **Người gửi cũng là người duyệt của một bước → tự động duyệt phần của mình** ("Approved automatically"). Hết bước → **Approved**. **Reject** (bắt buộc lý do) kết thúc ngay. **Transfer** chuyển phần của mình cho người khác. Người gửi: **Withdraw** khi đang chờ, **Remind** (tối đa 10 phút / lần, 429 nếu sớm hơn), **Submit again** (mở form điền sẵn câu trả lời cũ, trừ tệp). Ai thấy được yêu cầu đều **bình luận**. Mọi việc ghi vào `approval_events` (dòng thời gian). Hành động khoá dòng yêu cầu (`FOR UPDATE`) nên hai người bấm cùng lúc không làm hỏng trạng thái. |
| Ai thấy | Người gửi; người mà yêu cầu **đã tới lượt** (task khác waiting — người ở bước sau chưa thấy, chưa mở được tệp); admin của mẫu; chủ / admin workspace. Người khác: 404. |
| Tệp đính kèm | Người duyệt / CC được quyền **xem** tệp đính kèm **khi tới lượt họ** (chỉ tệp do người gửi tải lên, nên không vượt quyền người gửi). |
| Thông báo | Chuông: `approval.pending` (cần bạn duyệt / được nhắc), `approval.cc`, `approval.result` (yêu cầu của bạn được duyệt / bị từ chối), `approval.comment`; realtime `approvals.changed` tới người gửi và người trong quy trình. Sidebar: số yêu cầu chờ bạn (badge cam). Chuông có icon riêng cho lịch, task, cuộc gọi nhỡ, phê duyệt. |
| Khi được duyệt | Mẫu có thể chọn một trường khoảng ngày → **sự kiện Out of office cả ngày trong My Calendar của người gửi** (Calendar §71) — mẫu Nghỉ phép dùng sẵn. |
| Giao diện | `/approvals`: cột trái **Pending** (số) / **Processed** / **Submitted** / **CC'd to me**, mục Manage (**All requests** nếu quản lý mẫu nào đó, **Templates**). Danh sách (ô tìm, lọc trạng thái, lọc loại; dòng: icon mẫu, người gửi, AP-số, 3 câu trả lời đầu, trạng thái, "waiting on …") + chi tiết (câu trả lời, tệp — khoá nếu không có quyền, **dòng thời gian quy trình** từng bước / từng người / ghi chú, hoạt động + bình luận, thanh hành động Approve / Reject / Transfer / Remind / Withdraw / Submit again). **New request** → thư viện mẫu theo nhóm → form (trái) + quy trình xem trước (phải, chọn người duyệt nếu cần). **Trình thiết kế mẫu**: Basics (tên, mô tả, nhóm, icon, màu, bật / tắt, admin mẫu, việc khi được duyệt), Form (thêm / sửa / xếp / xoá trường, lựa chọn, đơn vị, loại tiền, bắt buộc), Process (sơ đồ dọc Submitter → các bước → End, nút + giữa các bước để chèn bước duyệt / CC; mỗi bước: tên, nguồn người duyệt, any / everyone, điều kiện). |
| Seed | 5 mẫu: Leave request (quản lý → HR nếu > 3 ngày → CC HR, Out of office), Expense reimbursement (quản lý → Finance nếu ≥ ¥50,000), Purchase request (quản lý → Giám đốc **và** Finance nếu ≥ ¥200,000), Business trip (quản lý → quản lý cấp 2 nếu ≥ ¥100,000), General request (người gửi chọn). 6 yêu cầu ở mọi trạng thái. |
| Giới hạn | Chưa nhánh song song (chỉ tuần tự + điều kiện bỏ qua bước), chưa "trả lại để sửa" (return), chưa người duyệt theo vai trò Space / phòng ban, chưa uỷ quyền khi vắng mặt, chưa xuất CSV, chưa gửi thư; Flow designer (§ sau) sẽ có thể kích hoạt phê duyệt. |
| Test | `approvals.mjs` (74, chạy lặp lại được): mẫu theo người quản lý, ai thấy yêu cầu, xem trước tuyến (ngắn → chỉ quản lý, > 3 ngày → HR, bước tự chọn), kiểm tra câu trả lời, tải tệp, gửi + chuông + quyền xem tệp theo lượt, quản lý duyệt → HR → CC → Approved + chuông + Out of office + dòng thời gian, transfer, finance reject + chuông, "and" cần đủ, "or" người đầu quyết, tự chọn người duyệt, không có quản lý, tự duyệt phần của mình, withdraw, remind + giới hạn, bình luận + chuông, các hộp, lọc, tìm, thiết kế mẫu (quyền, kiểm tra, sửa theo admin mẫu, tắt, xoá). `approvals-flow.mjs` (9): badge + hộp Pending, gửi nghỉ phép (thư viện, form, xem trước quy trình đổi theo số ngày, đính kèm), quản lý duyệt live kèm ghi chú, HR (reject cần lý do) duyệt → Approved + Out of office, transfer, reject, withdraw + submit again, thiết kế mẫu mới và gửi, tìm trong All requests. |

## 75. Phase 7 — Base (cơ sở dữ liệu kiểu Airtable / Lark Base): quyết định

Base là một tài nguyên Drive loại `base` (quyền = quyền của tài nguyên: viewer đọc, commenter bình luận, editor sửa record / trường / view / bảng). Mô hình dùng chung ở `@workos/base-model` (API kiểm tra + CSV, web hiển thị + lọc).

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| 1 | Mô hình (21 kiểu trường, công thức, ép kiểu giá trị, lọc / sắp xếp / nhóm / tổng hợp, CSV), bảng Postgres, API: bảng, trường (đổi kiểu có chuyển dữ liệu), view, record (lô, chèn sau, kéo thứ tự), liên kết bảng, bình luận, CSV vào / ra, đính kèm, form view, realtime, seed | **xong** |
| 2 | Giao diện Grid: ô sửa tại chỗ theo kiểu, chọn / dán nhiều ô, thêm / sửa trường, lọc / sắp xếp / nhóm / ẩn trường / chiều cao dòng, dòng tổng, drawer record + bình luận | **xong** |
| 3 | View Kanban / Calendar / Gallery / Form (trình dựng + trang trả lời), import / export CSV trên UI, e2e | **xong** |

**Đợt 1 — quyết định**

| Vấn đề | Quyết định |
|---|---|
| Lưu trữ | Bảng quan hệ, không Yjs: `base_tables` (primary field, `auto_seq`), `base_fields` (type, options jsonb, position), `base_views` (type, config jsonb), `base_records` (`values` jsonb theo field id, `position` khoá phân số, `auto_number`, created / updated by + at), `base_comments` (migration 0025). Giới hạn: 50 bảng / base, 200 trường, 50 view / bảng, 20.000 record / bảng, 1.000 record / lần ghi. Base mới (hoặc chưa có bảng) tự có **Table 1**: Name / Notes / Status + Grid view — tạo dưới advisory lock để hai tab mở cùng lúc không tạo hai bảng. |
| Kiểu trường | text, longText, number, currency, percent, checkbox, singleSelect, multiSelect, date (+ giờ), person (một / nhiều), link (bảng khác trong cùng base), attachment, url, email, phone, rating (1–10 sao), formula, autoNumber, createdTime, modifiedTime, createdBy. Năm kiểu cuối là **tính toán** — không lưu, không ghi được. Primary field không được là link / attachment / checkbox và không xoá được. Tên trường duy nhất (không phân biệt hoa thường), không chứa `{ }`. |
| Ép kiểu giá trị | `coerceValue` dùng chung cho API, dán và CSV: `¥1,200,000` → 1200000, `15%` → 0.15, `yes / ✓ / x` → true, `2026/11/30`, `10/07/2026` → ngày, tên / e-mail → người, tên lựa chọn (không phân biệt hoa thường) → id, **lựa chọn mới được thêm vào trường** khi gõ / dán / import; tiêu đề record → link (không tìm thấy thì bỏ); rating kẹp theo max; e-mail sai → trống. Ghi theo field id **hoặc tên trường**. |
| Công thức | Ngôn ngữ kiểu Airtable: `{Tên trường}`, `+ - * /`, `&` nối chuỗi, so sánh `= != < <= > >=`, ~45 hàm (SUM, AVERAGE, ROUND, IF, AND / OR, CONCAT, UPPER, LEFT, FIND, SUBSTITUTE, TODAY, NOW, DATETIME_DIFF, DATEADD, YEAR…). Lỗi cú pháp / tên trường sai bị từ chối khi lưu (*"Formula: No field named "Nope""*); lỗi khi tính (chia 0, vòng lặp công thức) hiện `#ERROR!`. Giá trị select / người / link đi vào công thức dưới dạng **tên**. Đổi tên trường → các công thức dùng nó được viết lại. |
| Đổi kiểu trường | Dữ liệu được chuyển: giá trị cũ dạng chữ (hoặc kết quả công thức) ép sang kiểu mới — text → single select tạo lựa chọn từ các giá trị; number ↔ text giữ số; single ↔ multi giữ lựa chọn; lựa chọn bị xoá thì giá trị bị xoá; sang kiểu tính toán thì bỏ giá trị lưu. Xoá trường → xoá giá trị và mọi chỗ view dùng nó (lọc, sắp xếp, nhóm, ẩn, thứ tự, stack / date / cover, câu hỏi form). |
| View | grid / kanban (stack theo single select đầu tiên) / calendar (trường ngày đầu tiên) / gallery (attachment đầu tiên làm ảnh bìa) / form. Config: filters (and / or, toán tử theo kiểu trường: contains, is, is any of, has all of, <, before, is me, is empty…), sorts (≤10, rỗng luôn cuối), groupBy, hidden, order, widths (60–800), rowHeight. API làm sạch config (bỏ trường lạ). Lọc / sắp xếp / nhóm chạy trên client bằng `applyView` (và trên server khi xuất CSV). Record mới tạo từ view đang lọc nhận sẵn giá trị khớp bộ lọc (`defaultsForView`). |
| Record | Thêm lô (có `afterId` để chèn sau một dòng), sửa lô (dán nhiều ô), kéo thứ tự (`between()`), xoá lô — **link tới record bị xoá được gỡ khỏi các bảng khác**. Xoá bảng → các trường link trỏ vào nó thành text chứa tiêu đề. `GET tables/:id/titles` cho ô chọn link. |
| Bình luận | Theo record, commenter trở lên viết; người viết hoặc admin xoá; số bình luận trả kèm record. |
| CSV | Xuất theo view (lọc, sắp xếp, trường đang hiện, giá trị dạng chữ, BOM UTF-8, tên file `Base - Bảng - View.csv`). Import tạo bảng mới: dòng đầu là tên trường, **đoán kiểu từng cột** (number, currency, percent, date (+ giờ), checkbox, email, url, longText, single select khi ít giá trị lặp lại). Nối thêm vào bảng có sẵn: khớp cột theo tên trường, báo cột bị bỏ qua. Parser RFC 4180 tự nhận dấu phẩy / chấm phẩy / tab. |
| Đính kèm | `POST /base/:id/attachments` (≤ 50 MB, editor) lưu blob làm asset của base; giá trị ô là `{id, name, mime, size}` và đọc qua `/resources/:baseId/assets/:id` (ai đọc được base đều tải được). |
| Form view | Hỏi các trường đã chọn (không bao giờ hỏi trường tính toán), câu bắt buộc, tiêu đề / mô tả / nút / lời cảm ơn. Form **open** nhận câu trả lời từ mọi người trong workspace (không cần quyền với base); form đóng chỉ dành cho editor. Bài nộp thành record (chỉ giữ trường được hỏi, createdBy = người nộp); thiếu câu bắt buộc → *"Please answer: Name"*. |
| Realtime | Tab đang mở base gửi `base.watch` (nhịp 30 s, server kiểm tra quyền xem) / `base.unwatch`; thay đổi gửi `base.changed` {records upserted / deleted, schema, comments} cho người xem trong 90 s gần nhất. |
| Seed | *Lead Tracker* (Marketing): bảng Leads 12 record (stage, nguồn, giá trị, owner, follow-up, fit, sản phẩm, công thức số ngày) với view All leads / Pipeline (kanban) / Follow-ups (calendar) / My hot leads (lọc is me + hot) / By source (nhóm) / Lead capture (form mở); bảng Campaigns link tới Leads + công thức cost per lead. *Vendor List* (Operations): 7 nhà cung cấp, view grid / kanban theo loại / calendar gia hạn. |
| Test | `base-model.ts` (30, chạy `npx tsx test/base-model.ts`): công thức, ép kiểu, lọc / sắp xếp / nhóm / tìm / tổng hợp, CSV. `base.mjs` (56): schema mặc định, quyền theo vai trò, 10 kiểu trường, ép kiểu khi tạo, lựa chọn mới, rating, auto number, trường tính toán không ghi được, sửa lô, chèn sau, kéo thứ tự, đổi tên viết lại công thức, đổi kiểu (text → select, number ↔ text), ràng buộc primary, view kanban / calendar / config, CSV xuất theo view, xoá trường, link (tiêu đề, cùng base, xoá record, xoá bảng), bình luận, import CSV đoán kiểu, nối CSV, đính kèm, form đóng / mở / bắt buộc / nộp, xoá. |
| Chưa làm | Sao chép base chưa chép bảng (bản sao mở ra với Table 1 mới); link hai chiều, lookup / rollup, dashboard và automation để sau (Flow). |

**Đợt 2 — Giao diện Grid: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Bố cục | `/base/:id` (và `/base` liệt kê các base như các app khác): thanh tiêu đề chung (sao, vị trí, người, Share); trái là **danh sách bảng** (thêm, đổi tên, xoá, Import CSV); trên là **tab view** (thêm Grid / Kanban / Calendar / Gallery / Form, đổi tên, xoá); thanh công cụ (**+ Record**, Fields, Filter, Group, Sort, chiều cao dòng, tìm kiếm, Download CSV); bên phải là **drawer record** khi mở (`?table=&view=&record=` trên URL). EditorShell chỉ còn điều phối các workspace (bỏ khung placeholder chung). |
| Lưới | Ảo hoá theo dòng (chỉ vẽ dòng gần màn hình, chiều cao cố định 32 / 56 / 88 px theo short / medium / tall); cột số thứ tự + primary **cố định bên trái**; kéo mép tiêu đề để đổi độ rộng (lưu vào view); menu cột: sửa trường, chèn trường bên phải, sắp xếp A→Z / Z→A, lọc, nhóm, ẩn, xoá; nút **+** thêm trường; nhóm có tiêu đề (màu lựa chọn, số lượng, thu gọn) và dòng *Add to …* điền sẵn giá trị nhóm; **dòng tổng** chọn theo cột (count, filled, empty, sum, average, min, max, checked) lưu trong `config.summaries`. |
| Bàn phím & chọn | Ô đang chọn viền xanh; mũi tên / Tab di chuyển, Shift + mũi tên hoặc Shift + click chọn vùng, Ctrl + A chọn hết; **gõ là sửa** (ký tự đầu thay nội dung), Enter sửa / xuống dòng, Esc huỷ, Delete xoá vùng, Shift + Enter mở record; **Ctrl + C** chép vùng dạng TSV, **Ctrl + V** dán khối từ lưới / Sheets / Excel (dòng thừa thành record mới, tên lựa chọn / người / record liên kết được nhận diện như khi gõ). |
| Sửa ô | Text / số / tiền / % / url / email / phone: ô nhập tại chỗ; long text: khung lớn (Ctrl + Enter lưu); ngày: date / datetime-local; checkbox và rating: bấm trực tiếp; select / multi / người / link: danh sách tìm kiếm thả xuống (Enter chọn, *Add “…”* tạo lựa chọn mới); attachment: danh sách file + tải lên / kéo thả. Sửa hiện **ngay** (ép kiểu phía client bằng cùng `coerceValue`), câu trả lời của server thay thế sau. |
| Dòng | Tích chọn nhiều dòng → thanh *N selected · Delete*; chuột phải: mở, chèn trên / dưới, nhân bản, xoá; kéo tay cầm để **sắp thứ tự** khi view không sắp xếp / nhóm; số bình luận hiện ở đầu dòng. |
| Trường | Hộp thoại trường: 21 kiểu theo nhóm (Basic / More / Computed), tuỳ chọn theo kiểu (số thập phân, tiền tệ, lựa chọn có màu, gồm giờ, nhiều người, bảng liên kết, số sao), cảnh báo khi đổi kiểu sẽ chuyển dữ liệu; **trình soạn công thức** chèn `{trường}` / hàm, kiểm tra cú pháp ngay và xem trước giá trị của record đầu tiên. |
| Lọc / sắp xếp / nhóm / ẩn | Popover theo view: điều kiện and / or với toán tử và ô giá trị theo kiểu trường (lựa chọn dạng chip, ngày + *today*, checkbox), nhiều mức sắp xếp, nhóm theo một trường, ẩn / hiện từng trường. Editor lưu vào view cho mọi người; **viewer lọc / sắp xếp riêng cho mình** (không lưu). |
| Drawer record | Mọi trường (cả trường ẩn) sửa tại chỗ, trường tính toán có khoá, mô tả trường, thông tin tạo / sửa, Alt + ↑ / ↓ chuyển record, xoá; bình luận (commenter trở lên). |
| Realtime | `useBaseLive`: gửi `base.watch` khi mở (0,3 s, 2 s, rồi mỗi 25 s), áp `base.changed` vào cache (upsert / xoá record, tải lại schema / bình luận / tiêu đề liên kết). |
| Test | `base-flow.mjs` (14): mở bảng đầu, gõ đè + Enter / Tab, tiền tệ, chọn / thêm lựa chọn, checkbox, trường công thức (lỗi cú pháp, xem trước, giá trị), thêm record, dán khối (tạo dòng mới), dòng tổng, sắp xếp / lọc / nhóm / ẩn (lưu vào view), drawer (sửa + bình luận), người thứ hai thấy thay đổi tức thì, xoá nhiều dòng, import CSV. |

**Đợt 3 — Kanban / Calendar / Gallery / Form: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Kanban | Một cột cho mỗi lựa chọn của trường single select (`stackField`; chưa chọn thì hỏi), cột *No …* chỉ hiện khi có record trống; thẻ (`RecordCard`): tiêu đề + tối đa 4 trường đang hiện (bỏ trường stack), số bình luận; **kéo thẻ sang cột khác** đổi giá trị, kéo trong cột sắp thứ tự khi view không sắp xếp; *New record* ở cuối cột tạo record với giá trị cột (và giá trị khớp bộ lọc) rồi mở drawer. |
| Calendar | Lưới tháng theo trường ngày (`dateField`: date hoặc created / modified time); chip tô màu theo single select đầu tiên, tối đa 4 / ngày (+N more), đếm record không có ngày; **kéo chip sang ngày khác** (giữ giờ nếu trường có giờ); nút + trên ngày tạo record ngày đó. |
| Gallery | Lưới thẻ; chọn trường attachment làm **ảnh bìa** (ảnh đầu tiên), thẻ hiện tối đa 5 trường; ô *New record*. |
| Form | Trình dựng trong view: tiêu đề, mô tả, câu hỏi = trường của bảng (thêm từ trường chưa hỏi, bắt buộc, lên / xuống, bỏ), nút gửi, lời cảm ơn, **mở cho cả workspace**, link `/bf/:viewId` (copy / mở). Trang trả lời `/bf/:viewId` ngoài khung app: ô nhập theo kiểu (radio / checkbox cho lựa chọn, danh sách người, chọn record liên kết, sao, tải file qua `POST /base/forms/:viewId/attachments` — người trả lời form mở không cần quyền với base), báo câu bắt buộc, màn hình cảm ơn + *Submit another answer*. Trạng thái trình dựng giữ cục bộ để thao tác hiện ngay. |
| Cập nhật view | `updateView` có `mutationKey`: chỉ áp cấu hình server trả về khi đó là lần cập nhật cuối còn chờ (đổi tiêu đề rồi tích *Required* liền nhau không bị ghi đè). |
| Test | `base.mjs` thêm 2 (58): form không có câu hỏi file thì từ chối file; người trả lời form mở đính kèm được. `base-views-flow.mjs` (7): kanban (cột theo trạng thái, kéo thẻ đổi trạng thái, thẻ mới trong cột), calendar (record đúng ngày, kéo sang ngày khác), gallery (ảnh bìa), form (dựng, bắt buộc, bỏ câu, mở cho workspace; người không có quyền trả lời → record xuất hiện trong grid). |

## 76. Phase 7.1 — Tasks kiểu Jira (Agile, Waterfall, Hybrid, AI-DLC): quyết định

Người dùng yêu cầu (2026-10-07): quản lý task như Jira — nhận việc, chia việc, ghi chú, kiểm soát chất lượng tiến trình; chạy được **Agile, Waterfall và kết hợp**; kéo thả vào sprint; sprint có ngày bắt đầu + độ dài (thường 2 tuần) với các cuộc họp Planning / Review / Retrospective / Daily 15 phút; nơi giao nhận, phân chia task, log bug; có phase và epic; mỗi dự án có bộ tài liệu kiểu Confluence theo bộ template BA (`D:\chuyển`: BRD, FRD, SRS, PRD, Business Case, CBA, Scope, Use Case, RACI, RTM, Risk Log, Change Request, Test Case…); mở rộng theo AI-DLC. Làm theo 4 đợt:

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| 1 | Loại issue + cây phân cấp, tiếp nhận yêu cầu (intake / triage), chia nhỏ (break down), liên kết & phụ thuộc, người theo dõi, tạo task từ tin nhắn Chat, phương pháp + lead của dự án | **xong** |
| 2 | Scrum: sprint (ngày bắt đầu, độ dài mặc định 2 tuần), Backlog kéo thả vào sprint, start / complete (chuyển việc dở), họp Planning / Daily / Review / Retro tự lên lịch (Calendar + Office Meet), bảng Retro → action item thành task, burndown, velocity, WIP | **xong** |
| 3 | Tài liệu dự án kiểu Confluence: cây trang theo dự án, thư viện template BA + AI-DLC, liên kết tài liệu ↔ issue (truy vết yêu cầu), tạo story từ tài liệu | **xong** |
| 4 | Chất lượng & Waterfall / Hybrid / AI-DLC: cổng duyệt phase, Definition of Done + luật chuyển trạng thái, log thời gian, chỉ số chất lượng (lỗi, mở lại, lead / cycle time, bị chặn), Gantt kéo dời + mũi tên phụ thuộc, phương pháp AI-DLC (Inception / Construction / Operations, Unit of Work, Bolt) | **xong** (4a chất lượng, 4b cổng duyệt + Gantt, 4c AI-DLC) |

**Đợt 1 — quyết định**

| Vấn đề | Quyết định |
|---|---|
| Loại issue | `tasks.type`: **phase › epic › story / task / bug / milestone › subtask** (`ISSUE_RANK` 0–3 trong `@workos/shared`). Cha luôn ở cấp cao hơn con; subtask chỉ nằm dưới story / task / bug; phase không có cha. Dự án Waterfall dùng phase → task / milestone; Scrum dùng epic → story → subtask; **Hybrid** = phase chứa epic chứa story (sprint ở đợt 2 chạy bên trong phase). Task cá nhân chỉ là task / subtask. Đổi loại hoặc dời cha (sang epic khác…) được kiểm tra: không vòng, cùng dự án, con vẫn thấp hơn cha. Migration: task có cha cũ thành subtask; seed: WEB = Scrum (3 epic, story có điểm, 1 bug, 2 yêu cầu chờ), B625 = Waterfall (5 phase, task, milestone Go-live, 4 phụ thuộc). |
| Thông tin issue | Người báo cáo (`reporter_id`), **story points**, ước lượng giờ (`estimate_minutes`), `resolution` (done / declined), `source` (tin nhắn chat). Tiến độ phase / epic = trung bình con (Gantt). Bảng, dashboard và số đếm dự án chỉ tính **work item** (story / task / bug, không phải yêu cầu đang chờ). |
| Nhận việc (intake) | Dự án có **lead** (nhận yêu cầu) và cờ `intake_open`. Ai **xem được** dự án (kể cả viewer) gửi **Request** (`POST /tasks/projects/:id/requests`, task / story / bug) → issue `triage = true`, người gửi là reporter, lead nhận chuông `task.request`. Tab **Intake** (số chờ): **Accept** (vào backlog, báo người gửi) hoặc **Decline** + lý do (đóng với resolution declined, báo người gửi). Yêu cầu không lên bảng / Gantt / lịch. Lead hoặc admin Space đổi phương pháp, lead, đóng / mở intake. |
| Chia việc | **Break down**: mỗi dòng một con — epic → story, story / task / bug → subtask, phase → task (`POST /tasks/:id/breakdown`, tối đa 50). Ô "+ Add …" trong drawer tạo đúng loại con. |
| Liên kết | `task_links`: **blocks / is blocked by** (phụ thuộc, kiểm tra **không vòng**), relates to, duplicates / is duplicated by — trong và giữa dự án mình xem được. Thẻ / dòng hiện **blocked** (số issue chặn chưa xong); xong issue chặn thì hết. Đợt 4 vẽ thành mũi tên finish-to-start trên Gantt. |
| Theo dõi | `task_watchers`: reporter + assignee tự theo dõi; nút mắt trong drawer. Bình luận báo cho người theo dõi + assignee + reporter + người tạo. |
| Từ Chat | Menu tin nhắn → **Create task**: chọn dự án (mình sửa được), loại, tiêu đề (dòng đầu), mô tả = tin nhắn → issue lưu `source` và **trả lời trong thread** của tin nhắn "📋 Created WEB-30: … link". Phải đọc được cuộc trò chuyện. |
| Giao diện | Header: nhãn phương pháp, tab **Intake** (số), nút **Request** cho người chỉ xem, ⚙ cài đặt dự án (phương pháp kèm mô tả, lead, intake). Thẻ: tên epic, icon loại, điểm, ⛔ bị chặn; cột có tổng điểm. List: **Group by Status / Hierarchy** (cây phase › epic › issue › subtask, gập / mở). Gantt nhiều cấp, icon loại, **milestone hình thoi**. Drawer: đường dẫn cha, loại, reporter, cha, điểm + giờ, banner yêu cầu (Accept / Decline), "From a chat message", con + Break down, Linked issues, theo dõi. Hộp tạo: chọn loại (Story / Task / Bug / Epic / Phase / Milestone), cha, điểm. |
| Test | `issues.mjs` (41, chạy lặp lại được sau `tasks.mjs`): phương pháp + lead, số đếm, cây phân cấp và các luật, dời cha / đổi loại, break down, intake (viewer gửi, lead nhận chuông, accept + báo, decline + lý do + báo, đóng intake, quyền cài đặt), liên kết + chặn + vòng, theo dõi + chuông, task từ chat + trả lời thread + quyền. `tasks.mjs` cập nhật (bảng = work item, B625 đếm 10 task). `issues-flow.mjs` (10): thẻ có epic / điểm, intake (viewer gửi bug → lead accept → lên bảng; decline), epic mới + break down, liên kết chặn, theo dõi, list theo cây, Gantt waterfall + milestone, đổi phương pháp, task từ tin nhắn chat. |

**Đợt 2 — Scrum: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Sprint | `sprints (project, name, goal, start_date, end_date, state planned / active / closed, ceremonies, committed / completed points & count)`. Dự án có **độ dài sprint mặc định** (`sprint_days`, 14 = 2 tuần) và **giờ Daily** (`daily_time`, 09:30). Sprint mới bắt đầu ngay sau sprint cuối (hoặc hôm nay), dài đúng độ dài mặc định — hoặc chọn ngày bắt đầu + 1–4 tuần / số ngày. Mỗi dự án **một sprint đang chạy**. Chỉ story / task / bug vào sprint (subtask đi theo cha); sprint đã đóng không nhận thêm. Xoá được sprint planned (issue về backlog). |
| Backlog & kéo thả | Issue có `sprint_id` và `rank` (vị trí phân số riêng cho backlog / sprint, độc lập với `position` của bảng). Tab **Backlog** (Scrum / Hybrid): sprint đang chạy, các sprint planned, Backlog (việc chưa xong, chưa lên kế hoạch) — mỗi phần một danh sách theo rank. **Kéo thả** dòng giữa các phần và lên / xuống trong phần (`PATCH sprintId + rankAfter / rankBefore`; web tính trước cùng khoá `between()` nên dòng nằm đúng chỗ ngay). Mỗi phần: ngày, số issue, tổng điểm, mục tiêu, "+ Create issue" ngay trong phần đó, Start / Complete / Edit / Delete. |
| Bắt đầu sprint | Hộp Start: mục tiêu, ngày bắt đầu, độ dài, **"Put the Scrum ceremonies in Calendar"** (mặc định bật): **Sprint Planning** ngày đầu 10:00 (60 phút × số tuần — xác định và chia task), **Daily Scrum 15 phút** thứ 2–6 lúc giờ Daily (chỉnh được) từ ngày thứ hai đến hết sprint (một sự kiện lặp), **Sprint Review** ngày cuối 13:30 (60 phút × số tuần — báo cáo kết quả), **Sprint Retrospective** ngày cuối 16:00 (45 phút × số tuần — rút kinh nghiệm). Mỗi cuộc họp có **phòng Office Meet** (§73), nằm trong **lịch nhóm của Space** nếu người bắt đầu được thêm vào, không thì lịch cá nhân; mời lead + mọi người có issue trong sprint (chuông + thư + .ics như §71); mô tả có link Backlog / báo cáo / bảng Retro. Lưu cam kết (điểm, số issue) lúc bắt đầu. Sprint rỗng không bắt đầu. |
| Kết thúc sprint | **Complete**: việc chưa xong chuyển sang một sprint planned (chọn) hoặc về Backlog; lưu điểm hoàn thành. Kết thúc sớm → Daily dừng từ hôm nay (cập nhật `until` của sự kiện lặp). |
| Bảng | Scrum / Hybrid: bảng chỉ hiện **sprint đang chạy** (thanh trên: tên, ngày, còn bao nhiêu ngày, điểm xong / tổng, mục tiêu, link báo cáo); không có sprint chạy → hiện tất cả và nhắc lên kế hoạch. Task tạo từ bảng tự vào sprint đang chạy. **Giới hạn WIP** từng cột (cài đặt dự án): đầu cột "3/4", **vượt thì đỏ**. |
| Báo cáo | Tab **Sprints**: velocity (cột Committed / Completed theo sprint đã đóng, trung bình), danh sách sprint, báo cáo sprint — ô số, **burndown** (còn lại theo ngày so với đường lý tưởng; điểm nếu có, không thì số issue; chỉ vẽ tới hôm nay), các cuộc họp (giờ, "every weekday", Calendar, **Join**), Done / Not done. Biểu đồ theo skill dataviz: cùng cặp màu đã kiểm định của dashboard Tasks, đường lý tưởng là đường tham chiếu xám nét đứt, tooltip khi rê, nút Show table. |
| Retrospective | `retro_items`: ba cột **Went well / To improve / Action items**, thêm thẻ (commenter trở lên, khi sprint đã bắt đầu), **vote**, xoá (tác giả / quản lý); **Action item → Create task** tạo issue trong backlog (tag `retro`) và thẻ hiện mã task (✓ khi xong). |
| Test | `sprints.mjs` (47): sprint của dự án + đếm, kế hoạch + thứ tự + luật, tạo sprint (ngày sau sprint cuối, 2 tuần, 1–60 ngày), một sprint chạy, burndown, complete + chuyển việc + velocity, start + 4 cuộc họp đúng giờ Tokyo (Planning 10:00 2 giờ, Daily 09:15 15 phút T2–T6 đến hết sprint, Review 13:30, Retro 16:00) + phòng họp + lời mời, sprint rỗng, retro (quyền, vote, action → task một lần, xoá), kết thúc sớm dừng Daily, xoá sprint, cài đặt + WIP. `sprints-flow.mjs` (9, dự án riêng dựng qua API): backlog, **kéo thả** vào sprint + sắp xếp + giữ sau tải lại, sprint 1 tuần, complete + chuyển việc, start + lịch họp, bảng theo sprint, Sprints (velocity, burndown + tooltip, 4 cuộc họp + Join), retro (thẻ cũ, action → task, vote), WIP vượt giới hạn. `issues-flow.mjs` cập nhật: việc ngoài sprint nằm ở Backlog. |

**Workflow chuyên nghiệp (bộ trạng thái) — quyết định** (người dùng yêu cầu 2026-10-07: không chỉ To Do / In Progress / Done mà có fix bug, test, retest… theo bộ trạng thái của một hệ thống chuyên nghiệp)

| Vấn đề | Quyết định |
|---|---|
| Bộ trạng thái | `WORKFLOWS` trong `@workos/shared` — mỗi trạng thái `{id, name, color, category todo / doing / done, next[] (chuyển được sang), resolution (trạng thái done)}`. **Software development** (mô hình workflow phát triển của Jira Software có QA): To Do → In Progress → **Code Review** → **Ready for QA** → **In Testing** → (lỗi) **Fixing** → **Retest** → **UAT** → **Ready for Release** → Done; **Cancelled** (resolution cancelled); Done mở lại về Fixing / To Do. **Bug tracking** (vòng đời lỗi kinh điển kiểu Bugzilla / Jira): New → Confirmed → In Progress → Fixed → Retest → Verified → Closed, Reopened, **Won't Fix**. **Waterfall (stage gate)**: Not Started → In Progress → In Review → **Approved** → Completed, **On Hold**, Cancelled. **Scrum (simple)** (4 trạng thái cũ, đi tự do) và **Basic**. Các bộ dùng chung id cho cùng ý nghĩa (`todo`, `doing`, `review`, `done`, `retest`, `cancelled`…) nên đổi bộ không làm mất chỗ của issue. |
| Dự án | `projects.workflow` (software / scrum / basic / bug / waterfall / custom) + `strict_workflow`. Dự án mới: Waterfall → bộ Waterfall, còn lại → **Software development**, **Strict bật** (chọn khác được khi tạo). Seed: WEB = Software development, B625 = Waterfall (Strict tắt để dữ liệu mẫu tự do). |
| Luật chuyển | Strict bật: `PATCH status` sai đường → 400 *"In Testing" cannot move to "Done" in this workflow* (`canTransition`). Bảng: khi kéo, cột không được phép mờ đi và không nhận thả. Drawer: ô Status chỉ còn các bước hợp lệ, hàng **Next step** có nút cho từng bước kế (→ Code Review, → Fixing…). Vào trạng thái done ghi `resolution` của trạng thái đó (done / cancelled / wontfix); ra khỏi done thì xoá. |
| Đổi / chỉnh workflow | Cài đặt dự án có 3 tab **General / Workflow / Board**. Tab Workflow: chọn một bộ (thẻ hiện chuỗi trạng thái), bật / tắt Strict, **sửa trạng thái** (màu, tên, nhóm, sắp xếp, thêm, xoá) và **"Moves to"** từng trạng thái (bỏ trống = đi đâu cũng được) → workflow thành `custom`. Trạng thái bị bỏ: issue chuyển về **trạng thái đầu cùng nhóm** (In Testing → In Progress, Cancelled → Done). "Moves to" phải trỏ tới trạng thái có thật. Tab Board: giới hạn WIP từng trạng thái. Bảng nhiều cột (> 6) dùng cột hẹp hơn. |
| Log bug | Nút **Log bug** trên story / task (drawer): tiêu đề, bước tái hiện, người xử lý → `POST /tasks/:id/bugs` tạo **Bug** (ưu tiên High, tag `bug`) trong **epic / phase gần nhất** phía trên, cùng sprint, và **bug chặn (blocks) issue** đó cho tới khi xong (thẻ hiện ⛔). |
| Test | `workflows.mjs` (19): bộ mặc định theo phương pháp, bộ Bug tracking, Strict chặn nhảy bước + đi đủ đường dev → review → QA → testing → fixing → retest → UAT → release → done, mở lại, Cancelled / Won't Fix là resolution, vòng đời bug (cả Reopened), chỉ lead đổi workflow, đổi sang Scrum giữ chỗ theo nhóm, tắt Strict, "Moves to" không hợp lệ, Log bug (epic, chặn story, quyền). `tasks.mjs` cập nhật (11 trạng thái, bỏ trạng thái → đầu cùng nhóm, custom). `workflows-flow.mjs` (5): bảng có đủ trạng thái, kéo To Do → Done bị từ chối / → In Progress được, drawer đi qua Code Review → QA → Testing → Fixing → Retest, Log bug chặn story, đổi sang Bug tracking. |

**Đợt 3 — Tài liệu dự án kiểu Confluence: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Không gian tài liệu | Mỗi dự án một **thư mục tài liệu trong Space của nó** (`projects.docs_folder_id`, "<Dự án> — Docs") với các mục **01 Business, 02 Requirements, 03 Design, 04 Delivery & Quality, 05 Agile ceremonies, 06 AI-DLC**. Trang = tài liệu Docs bình thường (soạn cộng tác, bình luận, phiên bản, xuất DOCX / PDF) — quyền theo vai trò Space như Drive (viewer đọc, editor viết); không có bảng quyền riêng. |
| Template | `PROJECT_DOC_TEMPLATES` trong `@workos/doc-model` (32 mẫu; `templateDocument()` nhận cả mã `pd-…` nên `POST /resources {template}` dùng được). Cấu trúc theo bộ tài liệu BA của người dùng (`D:\chuyển`: BRD, FRD / FRS, SRS, PRD, Business Case, CBA, Project Vision, Scope, Use Case, Requirements Management Plan, RACI, RTM, Risk log, Change Request, Test Case…) — **chỉ lấy khung mục, lời hướng dẫn tự viết**. Tài liệu có kiểm soát mở đầu bằng bảng *Document control* (ngày, phiên bản, thay đổi, tác giả, người duyệt); bảng có cột ID (BR-001, FR-001, REQ-001, TC-001…) để truy vết. Nhóm: **Business** (Business Case, CBA, Project Vision, Scope Statement, Stakeholder Analysis, RACI, Communication Plan), **Requirements** (BRD, FRD, SRS theo IEEE 830 / 29148, PRD, Use Case, User Stories & Acceptance Criteria), **Design** (Solution Design + ADR), **Delivery & Quality** (Requirements Management Plan, RTM, RAID log, Change Request, Test Plan, Test Cases, Definition of Done, Release Notes), **Agile** (Sprint Planning / Review / Retrospective notes), **AI-DLC** (Intent, Inception: Requirements & Stories + biên bản mob elaboration, Units of Work, Domain Design, Logical Design & ADR, Bolt Plan, Operations Runbook). |
| Bộ khởi tạo | `PROJECT_DOC_SETS`: Agile (Scrum) / Agile (Kanban) / Waterfall (15 trang: BC, CBA, Scope, STK, RACI, BRD, FRD, SRS, SDD, RMP, RTM, TP, TC, CR, RAID) / Hybrid / **AI-DLC** — gợi ý theo phương pháp dự án; `POST /tasks/projects/:id/docs/setup` (editor; chạy lại không tạo trùng). Trang mới: thư viện template có tìm kiếm, trang vào đúng mục; tên "WEB · BRD — Business Requirements Document". |
| Truy vết yêu cầu | `task_docs (task, resource)`: issue ↔ tài liệu (chỉ document / wiki / note mình đọc được; liên kết cần quyền sửa dự án). Drawer issue có mục **Documents** (+ Document từ trang của dự án, ổ khoá nếu không mở được, bỏ liên kết). **Traceability matrix**: mọi trang của dự án + tài liệu khác mà issue trỏ tới → các issue (mã, loại, gạch nếu xong) + độ phủ xong / tổng; trang chưa có issue → "Not covered". Cây trang có số issue mỗi trang. |
| Từ tài liệu ra việc | `GET /tasks/docs/:id/items` đọc nội dung trang (Yjs) → các dòng: bullet, checklist, dòng bảng (cột đầu, ghép "ID + mô tả" khi có mã) kèm mục (heading) chứa nó. **Create issues** (chọn theo mục hoặc từng dòng, loại story / task / bug / epic, epic / phase cha) → issue được tạo **đã liên kết với trang**. Ví dụ: User Stories → story; AI-DLC Units of Work → epic. |
| Test | `project-docs.mjs` (22): chưa có không gian, viewer không tạo, bộ Waterfall đủ trang + mục, không tạo trùng, trang là tài liệu trong Space, viewer Space đọc, nội dung template có trong trang, bộ AI-DLC, trang lẻ + trang trắng + template lạ, **cả 32 template tạo được**, dòng của trang, tạo story từ dòng + liên kết, liên kết / bỏ liên kết + quyền + chỉ tài liệu, ma trận truy vết, số đếm trên cây. `project-docs-flow.mjs` (6): dựng không gian theo bộ gợi ý, trang từ thư viện, story từ trang, liên kết từ issue, ma trận, mở trang trong Docs. |

**Đợt 4a — Chất lượng tiến trình: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Definition of Done | `projects.dod` (danh sách, tối đa 20; dự án mới dùng `DEFAULT_DOD`: Acceptance criteria met, Code reviewed, Tests pass, QA tested no open critical bugs, Documentation updated, Product owner accepted) + `enforce_dod`. Cài đặt dự án → tab **Quality**: thêm / bỏ mục, bật **Quality gate**. Mỗi work item có checklist DoD riêng (`tasks.dod_done`, chỉ nhận mục có trong DoD). |
| Tiêu chí nghiệm thu | `tasks.criteria [{id, text, done}]` (tối đa 30) — Given / When / Then, tick khi đạt; drawer có mục **Acceptance criteria** (thêm bằng Enter, tick, xoá). |
| Cổng Done | Khi **Quality gate** bật: story / task / bug chỉ vào trạng thái done (resolution done) khi **mọi tiêu chí đã tick và đủ DoD** → nếu không: 400 *"Not done yet: 1 acceptance criteria and 6 Definition of Done items open"*. Cancelled / Won't Fix không bị chặn; epic / phase không bị chặn. |
| Log thời gian | `task_worklogs (task, user, minutes 1–1440, day, note)`: commenter trở lên log; người log hoặc lead xoá. Drawer: **Time · x h logged of y h** (thanh vượt ước lượng thì đỏ), ô giờ + ghi chú, danh sách log. `TaskView.spentMinutes`. |
| Chỉ số chất lượng | `GET /tasks/projects/:id/quality`: bug (mở, đóng, high / urgent đang mở, số bug / 10 điểm), **bug mở / đóng theo tuần** (8 tuần), **mở lại** (từ done về chưa done) + tỉ lệ, **QA trả về** (vào Fixing / Reopened), **lead time** (tạo → done) và **cycle time** (lần đầu vào trạng thái làm → done) trong 90 ngày, việc **bị chặn**, quá hạn, **tuân thủ DoD** (việc xong có đủ DoD *hiện tại*), **độ phủ tiêu chí nghiệm thu**, giờ log so với ước lượng. Dashboard có phần **Quality**: 5 ô số (đỏ khi vượt ngưỡng) + biểu đồ cột Opened / Closed theo tuần (cùng cặp màu đã kiểm định, tooltip, Show table). |
| Phản hồi tức thì | Checklist (tiêu chí, DoD) giữ trạng thái cục bộ trong drawer (đổi ngay khi bấm, nhận lại giá trị server khi về); cập nhật issue có `mutationKey` — chỉ tải lại khi cập nhật cuối cùng xong, và sự kiện realtime `tasks.changed` không tải lại giữa chừng — để câu trả lời cũ không ghi đè thao tác mới. |
| Test | `quality.mjs` (22): DoD mặc định + sửa (không trùng / trống) + chỉ lead, cổng Done (tiêu chí + DoD, rồi chỉ DoD, tick DoD chỉ mục hợp lệ, rồi Done), Cancelled và epic không bị chặn, worklog (giới hạn, viewer, tổng, xoá theo quyền), chỉ số (bug, xu hướng tuần, mở lại, QA trả về, lead / cycle, tuân thủ DoD, độ phủ, giờ). `quality-flow.mjs` (4): tiêu chí + DoD chặn Done rồi cho Done, log giờ so với ước lượng, sửa DoD trong cài đặt, phần Quality trên dashboard (ô số, tooltip). |

**Đợt 4b — Waterfall / Hybrid: cổng duyệt phase và Gantt: quyết định**

| Vấn đề | Quyết định |
|---|---|
| Cổng duyệt phase (stage gate) | `tasks.gate_status` (none / requested / approved / rejected), `gate_approvers uuid[]`, `gate_decisions jsonb [{userId, decision, comment, at}]` (migration 0024). Phase dùng `criteria` làm **tiêu chí thoát** (drawer: *Exit criteria*). `POST /tasks/:id/gate/request {approverIds?, note?}` — chỉ phase, người có quyền sửa, mọi tiêu chí thoát đã tick (nếu không: 400 *"2 exit criteria still open"*); không chọn thì người duyệt là lead (hoặc người tạo dự án); bell `task.gate` cho người duyệt (mở phase trên Gantt). `POST /tasks/:id/gate/decide {decision, comment?}` — chỉ người duyệt; từ chối phải có lý do; **mọi người duyệt Approve → approved**, **một Reject → rejected** (lead + người phụ trách nhận bell); gửi lại thì bắt đầu lại từ đầu. Bỏ tick một tiêu chí thoát khi cổng đang chờ / đã duyệt → cổng về *none*. Lịch sử cổng nằm trong activity. `TaskView.gate` (chỉ phase). |
| Chặn đóng phase | Dự án **waterfall / hybrid**: phase chỉ vào trạng thái done (resolution done) khi cổng **approved** → nếu không: 400 *"Get the phase gate approved before closing the phase"*. Huỷ phase không bị chặn; scrum / kanban đóng phase tự do. |
| Mũi tên phụ thuộc | `GET /tasks/projects/:id/links` → các liên kết **blocks** trong dự án (`{id, fromId, toId}`, người đọc dự án xem được). Gantt (tách ra `GanttView.tsx`) vẽ mũi tên finish-to-start từ cuối thanh trước tới đầu thanh sau (SVG dưới thanh, không bắt chuột); **đỏ** khi việc sau bắt đầu trước khi việc trước xong (milestone được trùng ngày cuối), xám nhạt khi đúng; đầu bảng hiện *"N dependency conflicts"*. Hàng / thanh / mũi tên dùng chung toạ độ px (rem của app không phải 16px). Seed B625: UAT dời sang 26/10 để chỉ còn một xung đột thật (Backend → API integration). |
| Kéo để dời lịch | Người có quyền sửa kéo thanh (hoặc milestone) → dời cả ngày bắt đầu và hạn theo ngày nguyên; kéo **mép phải** → chỉ đổi hạn (không trước ngày bắt đầu). Trong lúc kéo: thanh, cột Start / Due và mũi tên đi theo; thả ra → `PATCH` (cập nhật lạc quan danh sách). Kéo thì không mở issue; bấm thì mở. |
| Hiển thị | Drawer phase có khung **Phase gate**: trạng thái, người duyệt + quyết định + bình luận, ô bình luận + **Approve / Reject** cho người duyệt, chọn người duyệt + ghi chú + **Request approval** (khoá khi còn tiêu chí thoát mở). Gantt hiện nhãn *gate requested / approved / rejected* cạnh tên phase. |
| Test | `gates.mjs` (26): chỉ phase có cổng, chờ đủ tiêu chí thoát, chặn đóng phase waterfall, viewer không gửi, gửi cho 2 người duyệt + bell (đường dẫn, ghi chú), chỉ người duyệt quyết, từ chối cần lý do, 1/2 duyệt vẫn chờ, một Reject → rejected + bell cho lead, gửi lại từ đầu, đủ duyệt → approved → đóng phase, lịch sử, mặc định lead duyệt, bỏ tick rút cổng, kanban không cần cổng, danh sách liên kết blocks, dời ngày. `gantt-flow.mjs` (5): mũi tên đỏ + đếm xung đột, kéo thanh dời lịch và hết xung đột (không mở issue), kéo mép phải chỉ đổi hạn, bấm vẫn mở issue, cổng phase: bị chặn → gửi → duyệt → đóng phase. |

**Đợt 4c — AI-DLC (AI-Driven Development Lifecycle): quyết định**

| Vấn đề | Quyết định |
|---|---|
| Phương pháp | `Methodology` thêm `'ai-dlc'` (chỉ kiểu, không đổi cột). Helper chung: `isAgile` (scrum / hybrid / ai-dlc → tab Backlog + Sprints, board theo sprint đang chạy), `needsGate` (waterfall / hybrid / ai-dlc → phase cần cổng duyệt để đóng), `sprintWord` (ai-dlc gọi sprint là **Bolt**). Web: `issueLabel` — epic hiện là **Unit of work** trong dự án AI-DLC (chọn loại, drawer, cha, chia nhỏ). |
| Ba phase | Tạo dự án AI-DLC → tự tạo `AIDLC_PHASES`: **Inception** (1 tuần, mob elaboration: AI soạn yêu cầu / story / unit, người hỏi lại, sửa và duyệt), **Construction** (3 tuần, mob construction theo bolt: domain model → logical design → code → test, người duyệt từng bước), **Operations** (1 tuần: IaC, triển khai, giám sát, runbook) — nối tiếp nhau từ hôm nay, mỗi phase có mô tả và 4 **tiêu chí thoát** làm cổng duyệt (đợt 4b): người quyết ở mỗi cổng. |
| Bolt | `sprintDays` mặc định **2**; tên `KEY Bolt N`; chọn độ dài 1 / 2 / 3 / 5 ngày (hoặc tuỳ chỉnh); tab hiện **bolts**, nút *Create / Start / Complete bolt*. Bắt đầu bolt lên lịch **Bolt Kickoff** (ngày đầu 10:00, 30 phút — duyệt kế hoạch AI đề xuất), **Bolt Review** (ngày cuối 15:00, 30 phút — kiểm chứng thứ AI tạo ra: demo, review code, kết quả test), **Bolt Retrospective** (15:30, 15 phút — prompt, ngữ cảnh, cách review); **không có Daily** (bolt chỉ vài giờ – vài ngày). |
| Tài liệu | Bộ tài liệu khuyến nghị = **AI-DLC** (Intent, Inception, Units of Work, Domain Design, Logical Design & ADRs, Bolt Plan, Operations Runbook, DoD) — cả API setup mặc định lẫn màn hình chọn bộ. |
| Test | `aidlc.mjs` (14): dự án AI-DLC + bolt 2 ngày, 3 phase nối tiếp (1 / 3 / 1 tuần) có tiêu chí thoát + cổng + mô tả, cổng chặn đóng rồi cho đóng khi duyệt, unit of work trong Construction, tên + độ dài bolt, nghi thức bolt (kickoff / review / retro, không daily; kickoff 30 phút), bộ tài liệu AI-DLC (8 trang). `aidlc-flow.mjs` (4): tạo dự án AI-DLC trên UI → 3 phase trên Gantt, epic hiện *Unit of work*, bolt 2 ngày + kế hoạch nghi thức không daily, docs khuyến nghị AI-DLC. |

**Board theo sprint / epic + swimlane (bổ sung 2026-10-07)** — người dùng hỏi "không chia theo epic và sprint à": board dự án có hàng điều khiển: **Sprint** (sprint đang chạy mặc định, sprint đã lên kế hoạch, Backlog = chưa vào sprint, All issues), **Epic** (lọc theo epic / None), **Swimlanes** theo epic / người làm / sprint (tiêu đề cột dùng chung, từng làn thu gọn được, đếm issue). Kéo thẻ sang làn khác đổi luôn epic (parent) / người làm / sprint cùng trạng thái. Tham số trên URL (`sprint`, `epic`, `lanes`); hai thay đổi liền nhau dựa trên query mới nhất. `/tasks` trần mở dự án dùng gần nhất (My tasks chỉ khi chọn, `mine=1`, có ghi chú vì sao chỉ 3 cột). e2e `board-lanes-flow.mjs` (4).

**List theo trạng thái / sprint + ngày sprint (bổ sung 2026-10-07)** — người dùng yêu cầu List có đủ trạng thái như Board, có nút Sprint để kéo việc "Not Started" vào, và sprint có ngày bắt đầu / kết thúc tuỳ chỉnh: List nhóm theo **Status** hiện **mọi trạng thái** của workflow (kể cả nhóm trống), kéo dòng sang nhóm khác đổi trạng thái (workflow chặt chỉ cho chuyển hợp lệ); nhóm theo **Sprint** (nút **+ Sprint**): mỗi sprint mở là một nhóm có khoảng ngày + Start / Complete, nhóm **Backlog** (chưa vào sprint, chưa xong); kéo dòng vào sprint / về backlog đổi `sprintId`. Mọi dự án đều dùng được sprint: dự án waterfall / kanban có sprint thì hiện thêm tab Backlog / Sprints và board theo sprint (như Hybrid). Form sprint: **Start date + End date** (độ dài tự tính, tối đa 60 ngày) và ô chọn nhanh độ dài; sprint mới mặc định bắt đầu ngày sau sprint cuối. e2e `list-sprint-flow.mjs` (5).

**Epic → Sprint, Not Started → Created (bổ sung 2026-10-07)** — mô hình người dùng mô tả: dự án có nhiều epic; mỗi epic có nhiều sprint (ngày bắt đầu / kết thúc riêng); task mới nằm ở **Not Started**; mỗi sprint có backlog riêng, đưa task vào bằng cách kéo từ Not Started; vào sprint thì task theo các trạng thái Created, In Progress, In Review, Approved, On Hold, Recheck, Completed, Cancelled. Thực hiện: `sprints.epic_id` (migration 0027) — sprint thuộc một epic (hoặc toàn dự án), tên mặc định `Epic · Sprint N` đánh số theo epic, sprint sau của epic bắt đầu ngày sau sprint cuối của epic đó; **mỗi epic một sprint đang chạy** (thay vì một sprint mỗi dự án). Đưa task vào sprint: trạng thái Not Started (trạng thái todo đầu tiên) → **Created** và task chưa có cha thì thuộc epic của sprint; rút ra khi vẫn Created → Not Started; task tạo thẳng trong sprint bắt đầu ở Created; việc đang làm giữ trạng thái khi đổi sprint. Bộ trạng thái Waterfall: Not Started, Created, In Progress, In Review, Approved, On Hold, **Recheck**, Completed, Cancelled (Review → Approved / Recheck; Completed → Recheck). Màn **Backlog** (mọi dự án): cột **Not Started** (+ nhóm thu gọn "Started outside a sprint") bên cạnh từng **Epic** với các sprint của nó (Start / Complete / sửa / xoá, + Sprint của epic, + Epic); form sprint có chọn epic. Board mặc định hiện **mọi sprint đang chạy**. Seed B625: epic Online booking (Sprint 1 đang chạy với task Created / In Progress / In Review / Recheck, Sprint 2), Staff app (Sprint 1), 3 task Not Started. Test: `planning.mjs` (13), e2e `planning-flow.mjs` (4).

**Sửa trạng thái ngay trên board (bổ sung 2026-10-07)** — người dùng thấy các trạng thái như "fix cứng": thực ra mỗi dự án có danh sách trạng thái riêng (sửa ở Cài đặt → Workflow), nay đưa ra board cho người quản lý dự án: cột cuối **+ Add status** (đặt trước các trạng thái hoàn thành; workflow chặt thì nối vào đường đi: cột trước được chuyển sang nó, nó chuyển sang cột sau), menu **⋯** ở tiêu đề cột: đổi tên, màu, dời trái / phải, **Delete status** (issue chuyển sang trạng thái cùng loại — server), **Edit workflow…** mở thẳng tab Workflow. e2e `status-edit-flow.mjs` (4).

§76 xong: `pnpm --filter api test:tasks` = tasks, issues, sprints, workflows, project-docs, quality, gates, aidlc; e2e thêm issues / sprints / workflows / project-docs / quality / gantt / aidlc-flow. `tasks.mjs` cần seed mới (`npx tsx src/db/seed.ts`) vì số đếm dự án WEB thay đổi sau các lần chạy e2e.

## 77. Phase 7 — Flow designer (sơ đồ workflow): quyết định

Theo ảnh "giao diện vê và trỉnh sửa workflow.png": một tài nguyên Drive loại mới **`flow`** (migration 0026), là tài liệu Yjs cộng tác như Docs / Forms (collab token, phiên bản, khôi phục, sao chép), mô hình chung ở `@workos/flow-model`.

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| 1 | Trình vẽ: thư viện hình, canvas, nối, kiểu dáng, sắp xếp, dữ liệu, thông tin workflow, trang, cộng tác trực tiếp, Prototype (đi thử), Present, Export, lịch sử phiên bản, mẫu | **xong** |
| 2 | Chạy tự động: trigger (form, record Base, phê duyệt, lịch…) và action (email, thông báo, task, record Base…), nhánh điều kiện, lịch sử chạy; thư viện hình theo draw.io + bộ BPMN 2.0 có mô tả; giải thích từng action | **xong** |

**Đợt 1 — quyết định**

| Vấn đề | Quyết định |
|---|---|
| Mô hình | `PlainFlow { info (version, status draft / review / published / archived, trigger, tags, description), pages, nodes, edges }`. Nút: hình (shape), x / y / w / h, chữ, biểu tượng, style (nền + độ mờ, viền + độ dày + nét liền / gạch / chấm, chữ: font, cỡ, đậm / nghiêng / gạch chân / gạch ngang, màu, căn lề, bóng), z, data (thuộc tính key / value). Đường nối: from / to + cạnh (top / right / bottom / left hoặc tự chọn), nhãn, style (màu, độ dày, nét, đầu mũi tên đầu / cuối: none / arrow / open / diamond / circle, kiểu đường: elbow / straight / curved). |
| Lưu trữ Yjs | Map `flowInfo`, mảng `pageOrder`, map `pages` / `nodes` / `edges` với **mỗi nút / đường nối là một giá trị JSON phẳng** (thay cả khi sửa). Ban đầu dùng Y.Map lồng nhau (mỗi thuộc tính một khoá) nhưng Ctrl+Z sau khi xoá không khôi phục đủ các đường nối kèm nhãn → đổi sang giá trị phẳng; người đọc vẫn nhận dạng Y.Map cũ. Hai người sửa cùng lúc các thuộc tính khác nhau của **cùng một hình** thì người sau thắng. |
| Thư viện hình | Flowchart (Process, Decision, Start / End, Document, Database, Subprocess, Input / Output, Manual step, Delay, Preparation, Connector), BPMN (Task, Start / Intermediate / End event, Exclusive / Parallel gateway, Data object), Basic Shapes (Rectangle, Rounded, Ellipse, Parallelogram, Diamond, Triangle, Hexagon, Cylinder, Star, Cloud), Containers (Group, Swimlane — luôn nằm dưới), Text (Text, Sticky note), Icons (20 biểu tượng → bước có icon). Mỗi hình có đường SVG, kích thước, màu mặc định và vùng chữ riêng; tìm kiếm; kéo thả lên canvas hoặc bấm để thêm giữa màn hình. |
| Canvas | SVG có lưới chấm; cuộn để di chuyển, Ctrl / ⌘ + cuộn để phóng to quanh con trỏ (20–300 %), công cụ Hand (H hoặc giữ Space), Fit to screen, menu zoom. Chọn (Shift để thêm), khung chọn kéo, kéo di chuyển (bám lưới 10 px), 8 tay cầm đổi kích thước, mũi tên dịch 1 / 10 px. **Cổng nối** hiện khi rê chuột / chọn: kéo từ cổng sang hình khác để nối (cạnh đích là cạnh gần nhất), thả vào chỗ trống → tạo bước mới đã nối và sửa chữ ngay. Công cụ Connect (C). Double-click hình → sửa chữ tại chỗ; double-click đường nối → sửa nhãn; double-click nền → thêm bước. Delete, Ctrl+Z / Y (Y.UndoManager theo người dùng), Ctrl+C / X / V / D (dán giữ nguyên nối giữa các hình được chép), Ctrl+A, Esc. |
| Định tuyến | Elbow vuông góc từ cổng ra 18 px rồi rẽ giữa chừng (bo góc 8 px), đi vòng khi ngược hướng; Straight; Curved (Bezier theo hướng cổng). Nhãn đặt giữa đoạn dài nhất (Yes xanh, No đỏ, còn lại xám). |
| Panel phải | **Style** (đổi hình, bảng màu đôi nền / viền, nền + độ mờ, viền + độ dày, nét, bóng), **Text** (nội dung, font, cỡ, B / I / U / S, màu chữ, căn lề, biểu tượng), **Arrange** (X, Y, W, H, lên trên / xuống dưới, căn trái / giữa / phải / trên / giữa / dưới và giãn đều khi chọn nhiều), **Data** (thuộc tính); khi chọn đường nối: nhãn, màu, độ dày, nét, kiểu đường, đầu mũi tên, đảo chiều. **Workflow Info** luôn hiện: Owner, Version, Status, Trigger, Tags. |
| Thanh công cụ | Select, Hand, Add Node, Connect, Comment (ghi chú dán tên người viết), AI Suggest (chờ Phase 6). Tiêu đề: Undo / Redo, **Present** (toàn màn hình, ← → qua trang, Esc), **Export** PNG (2×) / SVG của trang, dữ liệu .json. Dưới trái: chọn trang, đổi tên / xoá, + trang. |
| Tab | **Design**; **Prototype** — đi thử từ Start, chọn nhánh ở mỗi quyết định, đánh dấu đường đã đi, hiện thuộc tính của bước; **Collaborate** — người trong flow, ai đang ở đây; **History** — lưu / xem / khôi phục phiên bản (API xem + khôi phục cho `flow`). Cộng tác trực tiếp: con trỏ có tên và vùng chọn của người khác trên cùng trang. |
| Tạo mới | `/flow` liệt kê flow + mẫu (Blank: Start → First step → End; **Customer booking approval** đúng như ảnh tham chiếu: form → kiểm tra → còn chỗ? Yes / No → email + link họp → task cho nhân viên → CRM); menu **New → Flow (Diagram)**. Seed: *Customer Booking Approval Workflow* (Sakura Beauty), *Lead Handling Flow* (Marketing). |
| Test | `flow.mjs` (8): tạo, collab token, quyền, nội dung trống / mẫu qua phiên bản, khôi phục, sao chép, liệt kê. `flow-flow.mjs` (13): tạo từ mẫu, kéo hình vào, nối từ cổng, sửa chữ, nhãn đường nối, style, di chuyển, xoá + undo, workflow info, người thứ hai thấy thay đổi + con trỏ, trang, prototype, present + export PNG / SVG. |


**Đợt 2 — chạy tự động, thư viện hình (đã xong)**

Nguyên tắc: **sơ đồ chính là chương trình**. Mỗi hình có thể mang một *vai trò* (`node.automation = { role, type, config }`): **Trigger** khởi động một lần chạy, **Action** làm việc gì đó, **Condition** kiểm tra một giá trị rồi đi theo đường nối nhãn *Yes* / *No*; hình không vai trò chỉ là tài liệu — lần chạy đi xuyên qua. Công tắc `info.automation` bật / tắt cả flow. Mục tiêu dài hạn (Phase 6): AI chỉ cần đọc **catalog** (`GET /flows/catalog`: hình + ý nghĩa BPMN, trigger, action, phép so sánh, kèm mô tả) là sinh ra được sơ đồ chạy được.

| Vấn đề | Quyết định |
|---|---|
| Mô hình | `@workos/flow-model/automation.ts`: `TRIGGER_TYPES` (manual, form.submitted, base.recordCreated / Updated, approval.finished, task.statusChanged, schedule, mail.received), `ACTION_TYPES` (mail.send, notify, task.create, base.createRecord / updateRecord, approval.submit, chat.send, delay, webhook), `CONDITION_OPS` (eq, neq, contains, gt, gte, lt, lte, empty, notEmpty, truthy). Mỗi loại có `label`, `note`, **`description`** (giải thích đầy đủ: làm gì, nhân danh ai, cần lưu ý gì), `required` (khoá cấu hình bắt buộc) và `outputs` (những gì nó cung cấp cho bước sau). `validateAutomation(flow)` liệt kê vấn đề (thiếu trigger, thiếu form / người nhận, điều kiện thiếu giá trị, không đủ 2 nhánh Yes / No, action không được nối tới). |
| Mẫu `{{…}}` | `render()` / `renderValue()` / `renderObject()`: `{{trigger.answers.Họ tên}}` (đoạn đường có thể chứa dấu cách, không phân biệt hoa thường), `{{steps.<id hình>.taskId}}`, `{{flow.name}}`. Một mẫu chiếm trọn chuỗi giữ nguyên kiểu (số, danh sách). |
| Lưu trữ | `flow_triggers` (flowId + nodeId, type, config, enabled, nextRunAt) — bản sao của các hình Trigger, đồng bộ sau mỗi lần `DocStore.save` (hook `onSaved`) và sau import; `flow_runs` (trigger payload, status running / waiting / succeeded / failed / cancelled, `steps` jsonb từng bước với output / lỗi / nhánh, `context`, `pending`, `resumeAt`, runBy). Migration 0032. |
| Bộ máy chạy | `FlowRunnerService` (apps/api/src/flow/flow-runner.service.ts): đọc flow từ Yjs (`collab.currentState` → `readFlow`), duyệt từ hình trigger theo đường nối (hàng đợi; tối đa 200 bước, một hình ≤ 20 lần → "the diagram loops"); action chạy **nhân danh chủ sở hữu flow**, gọi các service khác qua `ModuleRef` (không vòng phụ thuộc); Condition → `evaluateCondition` + `branchEdges` (Yes / No theo nhãn, không nhãn = đi tiếp khi đúng). **Wait** → run `waiting` với `resumeAt`, tick 30 s tiếp tục (sống qua restart). Lịch (`schedule`) dùng lại `nextRun()` của §48, nhận slot bằng update có điều kiện. |
| Sự kiện từ module khác | `flow-hooks.ts`: EventEmitter + **AsyncLocalStorage** ghi nguồn gốc. Forms (`submit`), Base (`createRecords` / `updateRecords` — record theo tên trường), Approvals (`after` khi có kết quả — giá trị theo nhãn trường), Tasks (`update` khi đổi status), Mail (`receiveExternal`) gọi `flowHooks.fire(type, workspaceId, payload)`. Runner lọc trigger theo cấu hình (formId, tableId, templateId + status, projectId + toStatus, mailboxId). **Một flow không bao giờ tự khởi động lại từ hành động của chính nó** (record nó vừa sửa, task nó vừa tạo) — chuỗi giữa các flow khác nhau vẫn được; phát hiện qua bài test (vòng lặp vô hạn khi flow "đóng dấu" record đã kích hoạt nó). |
| API | `GET /flows/catalog`; `GET /flows/:id/automation` → `{ enabled, problems, triggers (+ nextRunAt), counts }`; `PUT /flows/:id/automation { enabled }` (ghi vào Yjs + đồng bộ ngay); `GET /flows/:id/runs`, `GET /flows/:id/runs/:rid`; `POST /flows/:id/run { nodeId?, input? }` (Run now, chạy đồng bộ, trả về run); `POST …/runs/:rid/resume` (Continue now), `POST …/runs/:rid/cancel`; `POST /flows/:id/import` (PlainFlow = file .json export → thay toàn bộ sơ đồ cho mọi người đang mở, rồi re-index trigger). Webhook: chặn địa chỉ nội bộ trừ khi `FLOW_WEBHOOK_ALLOW_LOCAL=1`; timeout 10 s. |
| Web | Inspector tab **Auto** (AutomationPanel.tsx): vai trò → loại → cấu hình với picker (Form, Base → bảng → trường, mẫu phê duyệt → trường, dự án → trạng thái, hộp thư, kênh chat, người) và **ô giải thích** cho loại đã chọn + danh sách placeholder dùng được (suy từ các trigger / action trên sơ đồ). Tab **Runs** (RunsPanel.tsx): công tắc Automation, vấn đề (bấm → chọn hình), danh sách trigger (lần chạy kế), **Run now** (+ input JSON), danh sách run và chi tiết từng bước (nhánh, output, lỗi, Continue now / Cancel), cập nhật trực tiếp qua `collab.notify(flowId, {type:'runs'})`; `/flow/:id?tab=runs` từ thông báo chuông (kind mới `flow.run`). Huy hiệu ⚡ / ▶ / ? trên hình có vai trò. Menu Export có thêm **Import flow data (.json)**. Workflow Info có ô Automation. |
| Thư viện hình | `shapes.ts` viết lại theo draw.io: **Flowchart** đủ bộ (process, decision, start/end, predefined process, document, multi-document, database, stored / internal / direct / sequential data, I/O, manual input, manual operation, preparation, delay, display, merge, extract, collate, sort, summing junction, or, loop limit, card, connector, off-page, annotation), **BPMN 2.0**: Events (start / intermediate / boundary / end × none, message, timer, signal, conditional, link, error, escalation, terminate, cancel, compensation; catch rỗng / throw tô đặc), Activities (task, user, service, script, manual, send, receive, business rule, sub-process [+], call activity viền dày, event sub-process nét đứt, transaction viền đôi), Gateways (exclusive ×, parallel +, inclusive ○, event-based, complex ✱), Data & Artifacts (data object / input / output, data store, text annotation, group), **Swimlanes** (pool, lane, vertical lane, phase, group box), Basic, Arrows & Callouts, Text. Mỗi hình: `description` (ý nghĩa, khi nào dùng), `keywords`, `bpmn` (kind, position, eventType, direction, taskType, gatewayType); ký hiệu BPMN vẽ bằng `markers` trong `shapePath()`. `searchShapes()` tìm theo tên / mô tả / từ khoá / thuật ngữ BPMN; `CONTAINER_SHAPES` cho hình nền. Panel: ghi chú từng nhóm, tooltip = mô tả, nút ⓘ mở thẻ giải thích. `shapeCatalog()` xuất toàn bộ làm dữ liệu. |
| UML & ER | Theo yêu cầu (draw.io có UML và quan hệ đối tượng để vẽ database): **Entity Relationship** (Entity / Table với ngăn thuộc tính — dòng đầu là tên bảng, mỗi dòng sau một cột, đánh dấu PK / FK; weak entity viền đôi; Chen: relationship, attribute, key / multivalued / derived attribute) và **UML** (class / abstract / interface / enumeration / object với ngăn `--`; package, actor, use case, system boundary, component, node, artifact, note, state, initial / final, activity, fork / join, lifeline, activation). Đầu mũi tên mới (`ARROW_HEADS` có nhãn + ý nghĩa): hollow triangle (kế thừa / realization), filled diamond (composition), hollow diamond (aggregation), crow's foot **| 1, < n, |< 1..n, o| 0..1, o< 0..n**. Inspector đường nối có **Preset** (`EDGE_PRESETS`: sequence flow, message flow, association, generalization, realization, dependency, aggregation, composition, ER 1—1, 1—n, n—n, 0..1—0..n, 1—1..n) ghi ngay style + chú thích ý nghĩa. Shift+Enter xuống dòng khi sửa chữ. Mẫu **Order database (ER)** và **Order classes (UML)**. |
| Mẫu | Blank: Start = trigger manual. Booking: "Booking Form Submitted" = trigger form.submitted (người dùng chọn form), "Available slot?" = condition, "Send email + meeting link" = mail.send, "Create task for staff" = task.create (chọn dự án). |
| Test | `flow.mjs` (+3: mẫu ER, mẫu UML, catalog). `flow-automation.mjs` (36): import, Run now Yes / No, mẫu, notify + task thật, problems, action thiếu cấu hình, vòng lặp, webhook nội bộ, Wait → Continue / Cancel, trigger Base created / updated (lọc theo bảng, không tự kích hoạt lại), công tắc tắt / bật, task status (lọc project + status), schedule nextRunAt, quyền. `flow-automation-flow.mjs` (7): huy hiệu + tab Auto + giải thích, Runs tab, Continue now, công tắc, problems, thư viện BPMN, bảng ER + preset 1 — n. Sửa flake undo: thêm / xoá hình luôn là bước undo riêng (`undo.stopCapturing()`), vì gộp với lần sửa trước trong 400 ms thì giá trị map phẳng cũ không khôi phục được. |

## 78. Phase 7 — Wiki kiểu Confluence (spaces, cây trang, bộ tài liệu BA): quyết định

Theo bộ tài liệu tham chiếu ở D:\chuyển (BA toolkit, mẫu yêu cầu, mô hình hoá, review, rủi ro, test): một **space** là một thư mục Drive (quyền của thư mục = quyền của space), mỗi **trang** là tài nguyên loại `wiki` (tài liệu Yjs như Docs) nằm trong thư mục đó; cây trang, trạng thái, nhãn ở bảng `wiki_pages` (migration 0028).

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| 1 | Space (key, mô tả, màu, trang chủ), bộ khởi đầu (Blank, BA toolkit, Waterfall, Scrum, Kanban, Hybrid, AI-DLC), cây trang kéo thả, trạng thái + nhãn, sao chép (kèm trang con), xoá vào thùng rác, tìm trang, trang cập nhật gần đây, 61 mẫu (32 mẫu BA mới), tài liệu dự án (§76) dùng chung space | **xong** |
| 2 | Macro: mục lục, danh sách trang con, danh sách issue, panel, decision log, nhúng sơ đồ Flow; xem theo nhãn; lưu trữ (archive) trang | |

| Vấn đề | Quyết định |
|---|---|
| Mô hình | `wiki_spaces` (workspace, key duy nhất theo workspace, tên, mô tả, màu, folderId, homePageId, projectId). `wiki_pages` (resourceId PK, spaceId, parentId, position phân số, status `'' / draft / in_progress / review / approved / deprecated`, labels text[], template, owner). Quyền đọc / sửa lấy từ Drive (space nằm trong My Files hoặc trong một Space của tổ chức) — không thêm hệ quyền thứ hai. |
| Mẫu | `@workos/doc-model`: `template-kit.ts` (h, p, ul, ol, tasks, callout, table, doc…), `project-templates.ts` (mẫu dự án §76) + `ba-templates.ts` (BA plan, PM tasks, interview log / interviewee profile, brainstorming, document analysis, FRS, data dictionary, information requirements, requirement attributes / standards, glossary, 9 mẫu mô hình — BPMN, use case, activity, sequence, class, ER, DFD, state, component —, PDD, review log, RMP checklist, traceability worksheet, risk log / response, UC checklist). Mẫu `hidden` (trang chủ space) không hiện trong thư viện. Trang tạo từ mẫu bắt đầu ở trạng thái Draft. |
| Bộ khởi đầu | Mỗi trang được xếp dưới **trang mục** theo nhóm (Planning, Elicitation, Business, Requirements, Modelling, Design, Delivery & Quality, Agile, AI-DLC); trang mục tạo khi cần lần đầu. |
| Cây trang | Kéo thả: nửa trên / dưới của dòng = trước / sau, giữa = vào trong; client gửi cả `afterId` và `beforeId` để vị trí phân số nằm đúng giữa hai trang kề. Không cho đặt trang vào trang con của chính nó (400). Xoá trang → cả cây con vào thùng rác Drive; trang chủ không xoá được. Sao chép: trang trên cùng thành "X (Copy)", trang con giữ tên. |
| Giao diện | `/wiki`: danh sách space, tạo space (tên, key, ai thấy, bộ khởi đầu), trang cập nhật gần đây. `/wiki/s/:spaceId?page=`: thanh bên (tìm theo tên / nhãn, cây trang, + trang con, ⋯ sao chép / sao chép kèm trang con / chép link / lên cấp cao nhất / đặt làm trang chủ / xoá), đầu trang (breadcrumb, trạng thái, nhãn, số issue liên kết, owner, sửa lần cuối) rồi trình soạn Docs. `/wiki/:id` chuyển vào space của trang. Tab Docs của dự án dùng cùng cây trang và có nút "Open in Wiki". |
| Test | `wiki.mjs` (25), `project-docs.mjs` cập nhật; `wiki-flow.mjs` (10): tạo space với BA toolkit, trang mục, trang từ mẫu + trang con, kéo để sắp xếp / lồng, trạng thái + nhãn, tìm, sao chép kèm trang con + xoá, cài đặt space, trang chủ Wiki, link `/wiki/:id`. |

## 79. Phase 8 — Tổ chức, quản trị, dung lượng: quyết định

Mục tiêu bản open source: **một tổ chức ≈ 20 người**, đơn giản trước. Khách hàng mở hệ thống lần đầu → tạo tài khoản admin + gắn email hệ thống → tạo các nhóm / phòng ban (workspace của đội) → mời người. Bộ chính sách cho khách hàng: `docs/ORG-POLICY.md`.

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| A | Đăng nhập thật (email + mật khẩu, phiên), trình cài đặt lần đầu `/setup`, email hệ thống (SMTP + app password, mã hoá, hướng dẫn Gmail / Outlook, gửi thử), mời người qua email + trang nhận lời mời, quên mật khẩu, trang Admin → Members (vai trò, khoá / mở, mời lại) | **xong** |
| B | Nhóm / phòng ban: loại Space (department / team / project), cây cha-con, **trưởng nhóm** (vai trò admin của Space), **chức vụ theo từng nhóm** (một người nhiều nhóm, nhiều chức vụ), trưởng nhóm thêm người, lập kênh chat; danh bạ: quyền xem số điện thoại, nhãn nhóm + chức vụ khi chat | **xong** |
| C | Dung lượng: quỹ của tổ chức, hạn mức mỗi người, hạn mức mỗi nhóm, tính dung lượng chuẩn, chặn upload khi đầy, trang Storage; hiệu năng mở / lưu file | **xong** |

**Vai trò**

| Cấp | Vai trò | Quyền |
|---|---|---|
| Tổ chức | **Owner** (người cài đặt, 1 người, chuyển được) | mọi quyền Admin + chuyển quyền sở hữu, không bị khoá |
| | **Admin** | email hệ thống, mời / khoá người, vai trò, nhóm, hạn mức, xem mọi nhóm (admin của mọi Space như hiện nay) |
| | **Member** (`editor`) | dùng mọi ứng dụng, tạo DM / nhóm chat ≤ 10 người, thấy nhóm công khai |
| | **Guest** (`viewer`) | chỉ thấy thứ được chia sẻ trực tiếp, không thấy nhóm công khai, không xem danh bạ đầy đủ |
| Nhóm (Space) | **Trưởng nhóm** (`owner` / `admin` của Space) | thêm / bớt thành viên, đặt chức vụ, tạo kênh chat, quản lý file của nhóm, xem liên hệ đầy đủ của thành viên |
| | Thành viên (`editor`), người xem (`viewer` / `commenter`) | như §68 |

**Đợt A — quyết định**

| Vấn đề | Quyết định |
|---|---|
| Danh tính | Bảng `auth_credentials` (userId, scrypt hash N=16384, đổi lần cuối), `auth_sessions` (sha256 của token, user, hết hạn 30 ngày trượt, user agent, IP), cookie `mo_session` httpOnly SameSite=Lax. `workspace_members.status` active / suspended (khoá = xoá mọi phiên). Middleware: phiên hợp lệ → actor; không có phiên và **chế độ dev** (`AUTH_DEV=1`, mặc định khi không phải production) → bộ chọn người dùng cũ (`mo_uid`, `x-user-id`) để seed + test chạy như cũ; còn lại → 401 và web chuyển `/login`. |
| Cài đặt lần đầu | `GET /setup/status` → `{ needsSetup }` (chưa có workspace nào). `POST /setup` (chỉ khi needsSetup, trong một transaction có khoá): tên tổ chức, miền email (tuỳ chọn), tên + email + mật khẩu admin → workspace, user Owner, Space "General" công khai, phiên. Trình cài đặt web: 1 Tổ chức → 2 Tài khoản admin → 3 Email hệ thống (bỏ qua được) → 4 Nhóm đầu tiên + mời người (bỏ qua được). |
| Email hệ thống | `system_settings` (workspaceId, key, value jsonb). Khoá `smtp`: provider gmail / outlook / custom, host, port, secure, user (địa chỉ email), **password mã hoá AES-256-GCM** bằng khoá `SETTINGS_KEY` (env) hoặc khoá ngẫu nhiên sinh lần đầu lưu ở `apps/api/.secrets/settings.key`; API không bao giờ trả mật khẩu (chỉ `hasPassword`). Tên người gửi. `MailService` dùng cấu hình này trước `SMTP_URL`. Gửi thử. Hướng dẫn từng bước lấy app password ngay trong trang. Không bao giờ hỏi mật khẩu qua chat / log. |
| Mời người | `invitations` (email, vai trò, nhóm + chức vụ ban đầu, token sha256, hết hạn 7 ngày, người mời, trạng thái). Admin mời (email gửi link `/invite/:token`); người nhận đặt tên + mật khẩu → tài khoản + vào nhóm. Mời lại / huỷ. Email đã là thành viên → 400. |
| Quên mật khẩu | `/forgot` → email link `/reset/:token` (1 giờ, 1 lần), không tiết lộ email có tồn tại hay không. Admin cũng gửi được link đặt lại. |
| Không có email hệ thống | Lời mời / link vẫn tạo được: API trả link cho admin (hộp thoại mời, bước 4 của cài đặt, nút Resend chép link) để gửi tay. |
| Địa chỉ hệ thống | `general.appUrl` (lưu từ `location.origin` lúc cài đặt, sửa ở Admin → General) cho link trong email; không lấy từ header Origin của request chưa đăng nhập (chống đầu độc link đặt lại mật khẩu). |
| Test | `auth.mjs` (41): cài đặt chỉ một lần, chỉ admin, mời (link khi chưa có email, bỏ qua người đã là thành viên, nhóm + chức vụ), nhận lời mời → phiên httpOnly, đăng nhập / sai mật khẩu / email không phân biệt hoa thường, đổi mật khẩu đăng xuất nơi khác, đăng xuất, khoá → mất phiên + không đăng nhập được, mở lại, chỉ owner đặt admin, quên mật khẩu, SMTP (mật khẩu không bao giờ trả về, giữ mật khẩu khi đổi nhà cung cấp, lỗi gửi thử), địa chỉ hệ thống. `admin-flow.mjs` (10). `setup-flow.mjs` (8) chạy với API thứ hai trên DB trống, `AUTH_DEV=0` (xem đầu file). |

**Đợt B — nhóm, chức vụ, danh bạ**

| Vấn đề | Quyết định |
|---|---|
| Nhóm | Dùng lại Space (đã có cây `parentId`, thành viên, vai trò, kênh chat, file, lịch, mailbox). Thêm `spaces.kind` department / team / project / general. Trang Admin → Teams: cây phòng ban → đội, kéo người vào. |
| Chức vụ | `space_members.title` = chức vụ trong nhóm đó (vd. "Trưởng phòng", "Dev lead"); `users.title` = chức danh chính. Một người ở nhiều nhóm với nhiều chức vụ. |
| Danh bạ | Ai cũng thấy: tên, chức danh chính, email, các nhóm mình cũng thấy + chức vụ trong đó. **Số điện thoại / địa điểm**: chính mình, Admin, trưởng nhóm của một nhóm người đó thuộc, hoặc khi người đó chọn "hiện với mọi người" (`users.phoneVisibility` everyone / leads, mặc định leads). Guest chỉ thấy người cùng nhóm. |
| Chat | Thẻ người (hover tên trong tin nhắn, danh sách thành viên, đầu DM) hiện các nhóm + chức vụ, ưu tiên nhóm của kênh hiện tại và nhóm chung với người xem; "+n nhóm". Cạnh tên người gửi: nhãn nhóm + chức vụ đầu tiên theo thứ tự đó. Dữ liệu lấy từ `/contacts` (đã lọc theo quyền), một lần cho cả ứng dụng (`usePeople`). |
| Quyền theo vai trò tổ chức | Owner **và Admin** là admin của mọi Space (trước đây chỉ Owner); Guest (`viewer`) không nhận quyền xem Space công khai, chỉ thấy Space mình là thành viên và người cùng Space trong danh bạ (hồ sơ người khác → 404). Admin (không chỉ Owner) sửa chức danh / phòng ban / quản lý trong hồ sơ. |
| Admin → Teams | Cây Space (thụt lề theo cha), tạo phòng ban / đội / dự án (loại, thuộc về, công khai / riêng tư, trưởng nhóm + chức vụ), sửa tên / mô tả / loại / cha (không vào cây con của chính nó) / màu, thành viên: chức vụ (sửa tại chỗ), vai trò Lead / Member / Commenter / Viewer, xoá, thêm người. `PATCH /spaces/:id`; `POST /spaces/:id/members` nhận `title` (đổi vai trò giữ nguyên chức vụ; owner chỉ sửa được chức vụ của mình). |
| Test | `teams.mjs` (32), `contacts.mjs` cập nhật (số điện thoại ẩn với người không phải trưởng nhóm); `teams-flow.mjs` (10). |

**Đợt C — dung lượng**

| Vấn đề | Quyết định |
|---|---|
| Đơn vị tính | Dung lượng **logic** (như Google Drive): kích thước file hiện tại + các phiên bản cũ + tệp đính kèm mail + ảnh / tệp trong tài liệu; khử trùng lặp nội dung (blob theo sha256) là tiết kiệm nội bộ, không trừ của ai. Tài liệu cộng tác (Docs / Sheets…) tính theo kích thước trạng thái Yjs. Thùng rác vẫn tính cho tới khi xoá hẳn. |
| Ai chịu | File trong **My Files** → chủ sở hữu; file trong **Space của nhóm** → nhóm (như shared drive); đính kèm mail → người gửi / mailbox. |
| Hạn mức | Quỹ tổ chức (mặc định: không giới hạn ở bản open source, admin đặt theo ổ đĩa máy chủ), mặc định mỗi người (vd. 10 GB), mỗi nhóm (vd. 50 GB), ghi đè từng người / nhóm. Trang Storage: tổng / đã cấp / đã dùng, từng người, từng nhóm, file lớn nhất. Cảnh báo 80 %, chặn upload (413 "Storage full") khi vượt người / nhóm / tổ chức. |
| Hiệu năng | Kiểm tra hạn mức bằng một truy vấn SUM có index (`resources_owner_idx`, `resources_space_idx`) — vài ms với quy mô 20 người; bản doanh nghiệp: bảng đếm cập nhật trong cùng transaction + đối soát định kỳ. Mở file: stream từ S3, ETag = sha256 + `Cache-Control: private, max-age` cho nội dung bất biến; tài liệu cộng tác tải trạng thái Yjs một lần rồi đồng bộ tăng dần; lưu = cập nhật Yjs gộp, snapshot định kỳ. |

**Đợt C — cách làm (đã xong)**

| Vấn đề | Quyết định |
|---|---|
| Lưu chính sách | `system_settings` khoá `storage`: `{ orgBytes, userDefaultBytes (10 GiB), spaceDefaultBytes (50 GiB), users: {id → bytes \| null}, spaces: {…} }`; `null` = không giới hạn; không có khoá = mặc định. Không cần bảng mới, chỉ thêm index `resource_versions(resource_id)`, `mail_attachments(uploaded_by)` (migration 0031). |
| Tính dung lượng | `QuotaService` (apps/api/src/storage/quota.service.ts), một truy vấn CTE: mỗi `resources` (trừ folder, shortcut; **kể cả thùng rác**) = `size_bytes` + SUM `resource_versions` có blob khác blob hiện tại (phiên bản "Original upload" dùng chung blob nên không tính hai lần) + SUM blob trong `resource_assets` (ảnh / video trong tài liệu, tệp trong Base, tệp người trả lời Form). Tệp đính kèm mail: người tải lên chịu; thư nhận từ ngoài tính cho hộp thư nhận (người hoặc Space). File có `space_id` → nhóm; không → chủ sở hữu. Bản sao dùng chung blob nhưng vẫn tính đủ cho người nhận. |
| Chặn | `assertRoom(workspaceId, {spaceId, ownerId}, bytes)` **trước khi ghi S3** tại: upload Drive / Chat (`ResourcesService.upload`), sao chép (`copy`, cả cây thư mục), ảnh / media trong tài liệu (`DocsService.saveAsset`), đính kèm mail gửi đi, tệp Form, tệp Base. Vượt người / nhóm / tổ chức → **413 PayloadTooLarge "Storage full: …"** (thông điệp nói còn bao nhiêu). Không chặn: lưu Yjs khi soạn, snapshot phiên bản, khôi phục thùng rác, thư đến. |
| API | `GET /storage/me`, `GET /storage/space/:id` → `{ used, limit, percent, warning (≥ 80 % người / nhóm hoặc tổ chức), full, org }` (thành viên xem Space công khai hoặc mình tham gia). Admin: `GET /admin/storage` (báo cáo: cài đặt, tổ chức đã dùng / đã cấp / số bên không giới hạn, từng người, từng nhóm, 20 file lớn nhất), `PATCH /admin/storage` (mặc định), `PUT/DELETE /admin/storage/{users\|spaces}/:id` (hạn mức riêng / về mặc định). `/stats.storageBytes` giờ là dung lượng logic của tổ chức. |
| Web | Admin → **Storage** (StorageAdmin.tsx): thẻ tổng quan, "Default limits" (số + đơn vị MB / GB / TB, ô Unlimited), bảng People / Teams với thanh đo và ô Limit (Default / Unlimited / Custom…), danh sách file lớn nhất. Drive: thước đo cuối thanh trái (StorageMeter.tsx) cho My files và nhóm đang mở — vàng từ 80 %, đỏ khi đầy + ghi chú "Empty the trash"; bảng Details của Space có dòng Storage. Upload bị từ chối → toast thông điệp 413. |
| Hiệu năng mở file | `sendCached()` (common/http.ts): `ETag = "sha256"`, `Cache-Control: private, max-age=86400`, `If-None-Match` → **304** không mở stream S3 (service trả `open()` lười) cho `/resources/:id/download`, `/resources/:id/assets/:blobId` (immutable), `/mail/attachments/:id`. |
| Test | `storage.mjs` (51, chạy lại được: dọn hạn mức trước / sau), `storage-flow.mjs` (7). |

---

## 80. Phase 6 — Tầng AI: một trợ lý cho mọi ứng dụng, chạy model local (Ollama): quyết định

Yêu cầu (2026-10-08): AI sinh workflow; Sheets / Docs / Slides đang có cách gọi AI khác nhau → **gom hết lên thanh trên cùng**; triển khai thử **Ollama local** (cài ở `E:\ollama`, model ở `E:\ollama\models`); kiểm tra Sheets có chịu được độ phức tạp của `NB顧客管理表 (2026).xlsx` không rồi cho AI thử tạo sheet tương tự; banner + card visit (so với ChatGPT, mẫu Canva); **một nơi lưu prompt để tái sử dụng**. Tài liệu prompt: `docs/AI-PROMPTS.md` (sinh từ code).

| Vấn đề | Quyết định |
|---|---|
| Máy chạy | Không GPU rời (Intel Iris Xe), RAM 15,6 GB → Ollama chạy CPU. Đo được: `qwen2.5:3b` ≈ 10 token/s, `qwen2.5vl:7b` ≈ 4–5 token/s, nạp model ~30 s. Mặc định chọn **model chữ lớn nhất** (bỏ qua model vision); chỉnh theo từng ứng dụng ở AI → Model & settings. |
| Kiến trúc | `apps/api/src/ai`: `llm.ts` (client Ollama: `/api/chat` stream, **structured output** bằng JSON schema, `repeat_penalty` chống lặp, `parseJsonLoose` + `repairTruncatedJson` cứu câu trả lời bị cắt), `prompts.ts` (kho prompt dựng sẵn), `gen-flow.ts`, `gen-sheet.ts`, `gen-slides.ts`, `gen-design.ts`, `ai.service.ts` (cài đặt, kho prompt, **hàng đợi 1 job** — CPU không chạy song song, áp kết quả), `ai.controller.ts`. Vẫn để ngỏ provider khác (Anthropic, sidecar `cdfl_harness` §12). |
| Nguyên tắc với model nhỏ | Model **khai báo**, code **làm**: JSON gọn có schema (Ollama ép theo grammar, có `maxLength` / `maxItems`), 1–2 ví dụ trong prompt, rồi code sửa lỗi, bố cục, viết công thức A1, kiểm tra tương phản, **lấy sự thật từ yêu cầu** (điện thoại, email, website, địa chỉ, tên người — model không được bịa). Cái gì model nhỏ làm kém (đặt vị trí, viết công thức, nhớ đủ cột) thì không giao cho nó. |
| Kho prompt | Bảng `ai_prompts` (workspace, key, name, app, output, description, system, template, temperature, variables) + prompt dựng sẵn trong code. Admin **chỉnh** prompt dựng sẵn cho tổ chức (bản ghi cùng key) và **khôi phục**; ai cũng tạo prompt riêng (`custom.*`, tác giả hoặc admin sửa). Biến: `{{request}} {{language}} {{today}} {{context}} {{selection}} {{format}} {{canvas}}…`; ngôn ngữ đoán từ yêu cầu (Việt / Nhật / Anh / Trung). Kiểu kết quả: `flow`, `sheet`, `deck`, `template` (thiết kế theo mẫu), `design` (tự xếp — model lớn), `markdown`, `text`. |
| Job | Bảng `ai_runs` (prompt, model, trạng thái queued / running / done / failed / cancelled, yêu cầu, câu trả lời, kết quả, token, thời gian) = lịch sử + audit. `POST /ai/jobs` → poll `GET /ai/jobs/:id` (văn bản đang viết, token, thời gian, vị trí trong hàng), `POST …/cancel` (AbortController). File do AI tạo có `metadata.aiGenerated`, `aiPrompt`; AI chạy với quyền của người dùng (ghi vào file cần editor). |
| Flow | Model trả `{title, notation, lanes, steps[{id,label,type,lane,trigger,action…}], links}`. `repairFlowSpec`: id trùng, link hỏng, thêm Start / End, bước có ≥ 2 nhánh có nhãn → decision, Yes / No, **suy lanes từ bước** (model hay quên danh sách). Bố cục: xếp hạng theo đường dài nhất (bỏ cạnh vòng), trên → dưới, hoặc **swimlane trái → phải** khi có vai trò (BPMN). Trigger / action gắn sẵn (§77 đợt 2). Trong file Flow đang mở → thêm thành **trang mới**. ~35–60 s. |
| Sheets | Model **không viết công thức**: khai báo cột `lookup {sheet, key, match, value}`, `calc "Số buổi * Đơn giá"`, chỉ tiêu `{op sum/count/average…, where}` và `breakdowns {by, value}`. Code viết **INDEX/MATCH**, **SUMIFS nhiều khoá** (giá theo Dịch vụ + Loại gói), SUMIFS / COUNTIFS, SUBTOTAL; khớp tên cột lỏng (bỏ dấu, gần đúng, theo nghĩa/kiểu cột); sửa công thức A1 model tự viết; Thành tiền = SL × đơn giá; ô chọn dùng chung lựa chọn giữa các sheet; doanh thu luôn cộng cột tiền; định dạng tiền / ngày theo locale (dd/mm/yyyy), năm không dấu phân cách; header màu, freeze, bộ lọc, data validation, dòng tổng. **Pipeline nhiều bước** (`sheet.plan` → `sheet.table` mỗi sheet → `sheet.summary`); nếu yêu cầu đã liệt kê sheet / cột ("1) DATA KH: mã KH, …, giới tính (Nam/Nữ) … tên KH tự lấy từ DATA KH") thì **đọc thẳng cấu trúc** (`planFromRequest`), bỏ bước lập kế hoạch; sheet danh mục sinh trước và mã mẫu của nó được đưa vào prompt sheet giao dịch để lookup khớp. Kết quả thử yêu cầu kiểu 顧客管理表 (5 sheet) với `qwen2.5:3b`: ~3–4 phút, công thức đúng (xem AI-PROMPTS.md). Trong file Sheets đang mở → thêm **tab mới**. |
| Slides | Deck: `{layout, title, subtitle, bullets, right, notes}` → layout & theme của deck; sửa tiêu đề chỉ là số, 2 cột rỗng; theme theo ngành (spa → Sakura Beauty). Trong file đang mở → **thêm slide**. **Banner / card visit theo mẫu kiểu Canva** (`gen-design.ts`): model chỉ viết chữ + chọn mẫu (`split` / `band` / `center`; card `classic` / `minimal` / `band`) và bảng màu (blush-gold, sage, mocha, navy-gold, coral, ocean, lavender, mono — màu ghi trong yêu cầu thắng lựa chọn của model); code dựng bố cục (khối chữ trái, cụm tròn "ảnh" phải, huy hiệu %, nút CTA, liên hệ; card mặt thương hiệu có vòng logo + mặt chi tiết có icon). Banner ~20 s, card ~11 s. Khổ: web 1200×628, 1500×500, vuông 1080, story 1080×1920, leaderboard, A4, card 3.5×2 in / 85×55 mm. `slides.freeform` (model tự xếp) giữ cho model lớn — với 3B chữ chồng nhau. |
| Docs | Soạn tại con trỏ (Markdown → `markdownToHtml` → `insertContent`), tóm tắt (đoạn chọn hoặc cả tài liệu), viết lại đoạn chọn (thay thế). |
| Giao diện | **Nút AI trên thanh trên cùng** (Ctrl+J) mở **AiPanel** bên phải ở mọi ứng dụng; workspace đăng ký "file đang mở" (`useRegisterAi`: app, id, tên, quyền, lấy chữ / chèn chữ cho Docs) → gợi ý theo ngữ cảnh (Flow: vẽ trang mới; Sheets: thêm tab; Slides: thêm slide / banner / card; Docs: soạn / tóm tắt / viết lại; ngoài file: tạo file mới). Tiến độ: token, token/s, thời gian, "mô hình đang viết", Dừng; kết quả: Mở / Chèn / Thay thế / Sao chép; lịch sử. Trang **/ai**: Tổng quan, **Kho prompt** (lọc theo app, sửa, nhân bản, khôi phục, tạo mới, Thử), **Model & cài đặt** (danh sách model của Ollama, model mặc định / theo app, context). Bỏ tab "AI Assistant — Phase 6" của Docs và nút "AI Suggest" chết của Flow (giờ mở cùng panel). |
| So sánh | ChatGPT (gpt-image) cho banner / card **ảnh raster rất đẹp** (người mẫu, hoa, chữ vàng) nhưng **không sửa được chữ**; mẫu Canva = bố cục cố định + nội dung. Hệ thống: thiết kế **chỉnh sửa được** (chữ, hình) — thiếu ảnh. → đợt tiếp: **AI Image Studio** (§81): nối OpenAI / Gemini sinh ảnh nền không chữ, đặt làm lớp nền, chữ là các lớp sửa được; nhập ảnh có sẵn chữ → model vision đọc chữ + vị trí → lớp chữ, nhà cung cấp xoá chữ khỏi nền. |
| Sheets chịu được file thật? | Nhập `NB顧客管理表 (2026).xlsx` (14 MB): **13 sheet, 479 307 ô, 82 392 công thức** (VLOOKUP 76k, IF 61k, AND/MID 49k, AGGREGATE 21k, IFERROR, COUNTIFS, SUBTOTAL…), 129 vùng gộp, 106k ô danh sách chọn — **giữ đủ**, mọi hàm đều có trong Univer (kể cả AGGREGATE, XLOOKUP). Mất: **34 ảnh** (trình nhập chỉ đếm, chưa đưa vào drawing plugin), 4 liên kết ngoài, bộ lọc. Hiệu năng là giới hạn: nhập 36 s, API lên **2,1 GB** RAM khi nhập, trạng thái Yjs **100 MB**, mở trên trình duyệt **55 s**, heap **1,85 GB**, còn tính lại 82k công thức. Nguyên nhân chính: mỗi ô lưu nguyên style (~200 byte/ô). → Việc cần làm để "bằng hoặc hơn": (1) **bảng style dùng chung** (Univer hỗ trợ `s` là id) — dự kiến giảm 50–70 % dung lượng; (2) tải sheet theo nhu cầu / tách Yjs theo sheet; (3) nhập ảnh nổi (`SHEET_DRAWING_PLUGIN`), bộ lọc; (4) giới hạn RAM khi nhập (stream). |
| Test | `ai.mjs` (29: status, kho prompt + quyền, kiểm tra đầu vào, chạy thật workflow / banner / card / Docs, dừng job, `AI_FAST=1` bỏ phần chạy model), `ai-flow.mjs` (7). Script thử: `node apps/api/test/ai-try.mjs <promptKey> "<yêu cầu>" [model] [format]`. |

## 81. Phase 6 — AI Image Studio: ảnh từ ChatGPT / Gemini thành lớp sửa được, đổi thông tin, tải ảnh, đổi khổ: quyết định

Yêu cầu (2026-10-08): ảnh ChatGPT đẹp hơn thiết kế dựng sẵn → nối với ChatGPT / Gemini (và nhà cung cấp khác) để **sinh ảnh**, đưa ảnh vào hệ thống, **giữ nền, chỉ sửa chữ** (kiểu lớp Photoshop); thử quy trình: lấy ảnh từ ChatGPT → sửa thông tin → ra ảnh mới → tải về; tải theo những tỉ lệ nào; sửa ảnh ra sao. AI có ở góc trên (truy cập nhanh) **và** ở thanh trái (trang /ai — AI workspace, làm chi tiết).

| Vấn đề | Quyết định |
|---|---|
| Nhà cung cấp ảnh | `images.ts`: `ImageProvider { generate, edit }` — **OpenAI** `gpt-image-1` (generations / edits), **Gemini** `gemini-2.5-flash-image` (generateContent, responseModalities IMAGE), **Demo** (gradient sinh bằng sharp, để thử không cần khoá). Cài ở AI → Model & settings → Image AI; nút Test. Khoá API **mã hoá** bằng `auth/secrets` và **không bao giờ gửi về trình duyệt** (`hasOpenaiKey` / `hasGeminiKey`). Gói ChatGPT Plus trên web **không** phải khoá API: muốn hệ thống tự gọi ChatGPT cần khoá OpenAI API (trả theo lượt). Không có khoá vẫn dùng được: tải ảnh từ ChatGPT về rồi “Bring in a picture”. |
| Đưa ảnh vào | `POST /ai/pictures/import` (không chọn file) → **thiết kế mới đúng hình dạng ảnh**: khớp một khổ có sẵn nếu tỉ lệ lệch < 2 % (1512 × 793 → web banner 1200 × 628), nếu không thì rộng 1200 px theo tỉ lệ ảnh. `POST /ai/pictures/:id/import` → slide mới (hoặc nền của slide) trong bài đang mở. Ảnh xoay đúng EXIF, ≤ 2400 px, lưu thành asset của file. |
| Đọc chữ | Model vision đọc **nội dung** (local `qwen2.5vl:7b` qua Ollama, ảnh gửi ở ~865 000 px vì model trả toạ độ theo kích thước đó; hoặc Gemini). Model 7B đặt vị trí chữ nhỏ **sai** (đo trên banner ChatGPT: hàng hotline lệch hàng trăm px) → `ocr.ts`: **Tesseract** (tesseract.js, `vie+eng`, local, ~2 s; dữ liệu ngôn ngữ tải một lần vào `.cache/tessdata`) cho **toạ độ từng từ**; mỗi dòng của model được gắn vào chuỗi từ Tesseract đánh vần giống nhất (bỏ dấu, Levenshtein ≥ 0,72; chữ ngắn phải khớp hẳn; bỏ ký hiệu “*”, “&)”; không nối từ cách xa). Trên banner thật: 20 / 23 dòng đúng tới pixel; chữ nghệ thuật lớn (“30%” mạ vàng, chữ viết tay) giữ hộp của model. Cỡ chữ và đường chân chữ tính từ hộp mực (`inkMetrics`: chữ hoa có dấu ≈ 0,95 em, hoa / số 0,72, x-height 0,52, chân g/p/y 0,21). |
| Xoá chữ khỏi nền | Có OpenAI / Gemini → gửi ảnh + lệnh `image.removeText` (sạch, giữ hoạ tiết). Không có → **vá cục bộ** `patchOutText` (lấy mẫu màu ngoài hộp theo 4 hướng, nội suy, làm mờ, mép mềm): tốt với nền phẳng / chữ nhỏ, **để lại vệt mờ** ở vùng chữ lớn trên hoạ tiết. |
| Lớp chữ | Chữ thành text box tên “text from picture” (màu đo từ ảnh, tự co chữ khi dài). Nền là ảnh vẽ kiểu CSS **cover** → toạ độ đổi qua đúng phép cắt đó (trước đây lệch khi ảnh khác tỉ lệ slide). |
| Sửa thông tin (`image.retext`) | `retext.ts`, ba tầng: (1) **cặp chính xác** “cũ → mới” hoặc ‘cũ’ thành / sang ‘mới’ trong câu; (2) **dữ kiện có kiểu**: %, ngày dd/mm, số điện thoại, e-mail, website, “tháng N” — xuất hiện đúng một lần ở thiết kế và một lần ở yêu cầu thì thay (nhãn đi kèm như “hotline”, “đến”, “giảm” được tiêu thụ); (3) chỉ khi yêu cầu còn ý khác mới gọi model, và **mọi thay đổi của model chỉ được nhận nếu chữ thêm vào đều có trong yêu cầu** và dòng ngắn không phình (`acceptChange`) — thay đổi bị loại hiện ở cảnh báo. Lý do: thử với `qwen2.5:3b`, model tự ý đổi “Da thông thoáng” → “Làm sạch sâu”, “TỰ TIN” → “TỰ TỎA”. Ví dụ thật: “tháng 11, giảm 40%, đến 30/11, hotline 0909 888 999, sửa ‘THÁNG 10%’ thành ‘THÁNG 11’, ‘TÒA’ thành ‘TỎA’” → 5 lớp đổi đúng trong 2 s, không gọi model. Hộp chữ dài ra thì nới rộng tới mép slide; giữ định dạng (mark, căn lề, danh sách). |
| Tải ảnh | `GET /resources/:id/export?format=png|jpg&slide=N&scale=S`: S = 1, 2 (mặc định), 3, **3,125 = in 300 dpi** (slide vẽ ở 96 px/inch; file ghi density 300), 4; giới hạn ~40 megapixel (khổ lớn tự hạ). JPG nền trắng, chất lượng 92 (mozjpeg). Không có `slide` → .zip mọi slide. Tên file: “<tên> @300dpi.png”. UI: File → **Download as picture (PNG, JPG)…** (hộp thoại liệt kê kích thước px và mm khi in). Ví dụ banner 1200 × 628: 1× 1200 × 628, 2× 2400 × 1256, 3× 3600 × 1884, in 3750 × 1963 px = 318 × 166 mm, 4× 4800 × 2512. |
| Đổi khổ (Magic resize) | `POST /ai/pictures/:id/resize {format, mode}` → **file mới** cạnh file gốc, các khổ của `DESIGN_FORMATS` (16:9, web banner, banner rộng 1500 × 500, vuông 1080, story 1080 × 1920, leaderboard 728 × 90, A4, card 3,5 × 2 in / 85 × 55 mm). `fit` (mặc định khi nền là ảnh): cả thiết kế thu vào khổ mới, viền lấp bằng bản **mờ** của chính ảnh — chữ vẫn nằm đúng trên hoạ tiết của ảnh. `fill` (mặc định cho thiết kế dựng từ mẫu): giữ vị trí tương đối theo tâm, một tỉ lệ (không méo), ảnh phủ kín thì cắt kiểu cover, cỡ chữ theo tỉ lệ. Không cần AI. UI: File → **Resize to another format…** |
| Giao diện | Nút AI góc trên: trong Slides có “AI picture on this slide”, “Make the picture’s text editable”, “Put new information into this design”, “Bring in a picture from ChatGPT / Gemini”. Trang **/ai** (thanh trái, ngay sau Home): mọi tác vụ với đủ tuỳ chọn, chọn file đích, model, xem chạy trực tiếp, lịch sử. |
| Kiểm thử | `apps/api/test/image-studio.mjs` (khoá không lộ, nhập ảnh → đúng khổ / tên UTF-8, sửa thông tin chính xác không model, cặp “→”, không khớp thì báo lỗi, quyền; PNG 1× / in 300 dpi / JPG 2×, scale > 4 bị chặn; resize fit / fill, khổ lạ, quyền) — nằm trong `test:ai`. E2E `image-studio-flow.mjs` (nhập ảnh ở /ai, thêm chữ, AI đổi thông tin, tải PNG 300 dpi, đổi sang vuông). |
| Giới hạn / tiếp theo | Phông chữ lớp chữ là Inter (chưa nhận dạng phông nghệ thuật); vá cục bộ để lại vệt ở chữ lớn trên hoạ tiết (dùng OpenAI / Gemini edit để sạch); đổi khổ `fit` để lại viền mờ — khi có khoá có thể cho image AI **vẽ nối** ảnh ra khổ mới; đọc chữ local ~5 phút trên CPU. |

## 82. Phase 6 — Bài thuyết trình dựng trên ảnh: AI local lập kế hoạch + viết prompt, ảnh từ ChatGPT vào “khung ảnh”: quyết định

Yêu cầu (2026-10-08): thiết kế do AI local tự vẽ không đẹp → để **ChatGPT vẽ ảnh**, AI local chỉ **điều khiển**: ví dụ bộ 30 trang về Hạ Long và đặc sản — trang nào cần số liệu thì có số liệu, trang nào chỉ là ảnh thì để nguyên ảnh (người dùng sửa tay); (1) AI local viết prompt cho ChatGPT, (2) lấy ảnh đưa vào slide.

| Vấn đề | Quyết định |
|---|---|
| Prompt | `slides.photoDeck` (kết quả `photodeck`: lập **một phần** của bộ slide) + bước con `slides.photoDeck.parts` (chỉ khi yêu cầu không liệt kê phần) và `slides.photoDeck.detail` — trong kho prompt, admin chỉnh được. Loại trang: `cover` (ảnh + tiêu đề), `section` (ảnh + tên phần), `photo` (**chỉ ảnh, không chữ** — người dùng tự hoàn thiện), `caption` (ảnh + một dòng), `text` (3–5 ý), `data` (biểu đồ cột), `end`. |
| Cách “dạy” model nhỏ (đo bằng 4 lượt chạy thật) | Lượt 1: một lần lập cả bộ → `qwen2.5:3b` viết **6 trang** dù yêu cầu 30. Lượt 2: số trang đưa vào **grammar** (`minItems = maxItems`) → đủ 30 nhưng lặp một khuôn (phần → ảnh → chú thích → chữ → số liệu), 9 tiêu đề trống, “Cảm ơn” ở trang 7, số liệu cho rượu ba kích, chữ Trung lẫn vào (“Cảm谢大家”). Lượt 3: **chia theo phần** — code lấy các phần từ yêu cầu (`partsOfRequest`: “…: vịnh và các hang động, đảo, …, ẩm thực và đặc sản (chả mực, sá sùng, …), …”), chia số trang theo số mục (`partBudget`), model lập từng phần → cấu trúc đúng nhưng **bỏ sót món** và tiêu đề lạc đề. Lượt 4 (bản dùng): **mỗi mục được liệt kê có một trang ảnh do code tạo** (tên mục là tiêu đề, xen kẽ caption / photo), model chỉ **thêm** các trang còn lại của phần (chữ thực dụng, số liệu, điểm khác) với danh sách “đã có” trong prompt. Chi tiết: từng nhóm 5 trang, schema bắt buộc đúng số trang của nhóm (`i` enum); trang thiếu thứ cần (ảnh thiếu `img`, chữ thiếu ≥ 3 ý, số liệu thiếu ≥ 2 số) **hỏi lại riêng** với grammar bắt buộc. 30 trang ≈ 8–10 phút trên CPU. |
| Luật bằng code | `cleanPhotoPlan`: trang ảnh thiếu tiêu đề lấy chủ đề trước, trang chữ / số liệu thiếu tiêu đề bị bỏ; `end` chỉ cuối, `cover` chỉ đầu; số liệu ≤ 1/8 số trang; không hai trang chữ liền nhau; tiêu đề > 9 chữ bị cắt; bỏ chữ Hán / kana trong tiêu đề tiếng Việt. `ensureData`: yêu cầu có “số liệu” mà model không chọn trang nào → tối đa 2 trang chữ ở phần dễ có số (cách đi, mùa, giá, khách) thành trang số liệu. `picturePrompt`: prompt luôn mở đầu bằng **chủ thể tiếng Việt + nơi chốn** (“Sá sùng — Hạ Long, Vietnam.”) vì ChatGPT / Gemini đọc tiếng Việt còn model 3B không biết món Việt (viết “sashimi kiểu Nhật” cho sá sùng, “chai vang ở vườn nho” cho rượu ba kích, “Black Fish Fritters” cho chả mực); món ăn luôn dùng mẫu ảnh món ăn, địa điểm giữ mô tả của model khi nó nhắc đúng chủ thể; prompt rác / quá ngắn bị thay. Chú thích dưới ảnh phải nhắc đúng chủ thể (model ghi “Đảo Đầu Ngựa” dưới ảnh du thuyền). Gạch đầu dòng lẫn “section: …”, “end”, chữ của prompt ảnh bị lọc. So sánh `qwen2.5vl:7b` (dùng như model chữ): dàn ý hợp lý hơn nhưng 4,5 phút riêng bước này và **vẫn bịa** (Sun World Ba Na Hills, Dương Đông ở Hạ Long; 2 triệu khách / năm). Số liệu của model nhỏ không đáng tin → luôn ghi “Số liệu do AI đề xuất — cần kiểm tra”; số trông bịa (`plausibleFigures`: nhãn “c1”, “2”, hoặc toàn số nguyên 0–5) không vẽ biểu đồ mà thành **bảng để điền** (Hạng mục · Số liệu (đơn vị) · Nguồn), gợi ý của AI để trong ghi chú. |
| Dựng slide (`gen-photodeck.ts`) | 16:9. Trang có ảnh: **khung ảnh** = phần tử ảnh tràn trang tên `picture slot`, `alt` = prompt, ảnh tạm (SVG: “Ảnh cho slide N” + prompt); chữ nằm trên dải tối mờ (bìa: dải dưới; phần / kết: nửa trái; chú thích: dải đáy). Trang chữ: layout tiêu đề + nội dung của theme. Trang số liệu: biểu đồ cột + ghi chú nguồn / cần kiểm tra. Prompt ảnh cũng nằm trong ghi chú người nói. |
| Ảnh vào khung | `GET /ai/pictures/:id/slots` (số trang, prompt, đã có ảnh chưa); `POST /ai/pictures/:id/slots` (nhiều file, ≤ 40): file tên “slide 05.png” / “trang-5.jpg” / “05 ….png” vào đúng trang 5, còn lại lấp các khung trống theo thứ tự; ảnh **cắt vừa khung** (crop kiểu cover), không méo; thay lại được. UI: Slides → File → **Pictures for the picture slots…** hoặc nút AI → “Pictures for the picture slots”: danh sách prompt, nút copy từng prompt / tất cả khung trống (“Tạo một bức ảnh ngang tỉ lệ 16:9 (cho slide N): …”), nút “Put pictures in…”. |
| Giới hạn | Máy chỉ có CPU: 3B ≈ 10 token/s, 7B ≈ 4 token/s; sự thật (địa danh, số liệu) của model nhỏ không đáng tin → người dùng kiểm tra; ChatGPT vẽ từng ảnh (~30–60 s/ảnh); hệ thống chưa tự gọi ChatGPT khi chưa có khoá OpenAI API (§81). |

## 83. Sheets — workbook lớn: bảng style dùng chung, nhập trong tiến trình con, ảnh nổi, mở nhanh hơn: quyết định

Yêu cầu (2026-10-08): kết quả đo ở §80 (workbook `NB顧客管理表`, 14 MB, 13 sheet, 479 307 ô, 82 392 công thức, 34 ảnh) cho thấy Sheets **giữ đủ** nội dung nhưng hiệu năng là giới hạn: trạng thái Yjs 100 MB, API 2,1 GB RAM khi nhập, mở trên trình duyệt 55 s, heap 1,85 GB, mất 34 ảnh. Người dùng chọn làm mục này tiếp theo.

| Vấn đề | Quyết định |
|---|---|
| Nguyên nhân chính | Mỗi ô lưu nguyên object style (~200 byte) dù cả workbook chỉ có **254 style khác nhau** (đo được); Univer tính lại **toàn bộ** 82k công thức mỗi lần mở (`initialFormulaComputing: FORCED`); ExcelJS giữ cả workbook trong tiến trình API. |
| Bảng style dùng chung | `Y.Map 'styles'` (`STYLES_MAP`): id → CellStyle; ô giữ `s: id`. **Id = hash nội dung** (FNV-1a 64 bit trên JSON chuẩn hoá — khoá sắp xếp, bỏ null/rỗng; `styleId`, `canonicalStyle`) → hai client intern cùng style ghi cùng khoá, không xung đột; không cần migration: mọi reader nhận cả id lẫn object (`resolveStyle`, `resolveCell`, `StoredCell`). `createYSheet(s, styles)` intern khi ghi (cache theo JSON thô: 480k ô → vài trăm lần băm); `readWorkbook(doc)` trả object (**chia sẻ tham chiếu**, không cấp phát) cho exporter / HTML / CSV / tìm kiếm; `readWorkbook(doc, { styles: 'table' })` giữ id + trả bảng — đúng hình dạng snapshot Univer (`styles`), client nạp thẳng không bung từng ô. Binding: ghi ô → `toStoredCell`; so sánh thay đổi theo **id** (`styleKeyOf`), replay sang Univer → resolve object. Writers phía server (`appendRows`, `macro-apply`) intern; `scripts/compact-styles.mjs <id>` chuyển workbook cũ sang bảng (chạy như một editor qua Hocuspocus). |
| Lưu rẻ hơn | `DocStore.save` chạy mỗi 2–10 s khi gõ; trước đây `readWorkbook` + `workbookText` bung 479k ô mỗi lần. Nay `workbookSummary(doc)` đọc thẳng Y.Map, dừng ở giới hạn 200k ký tự. |
| Nhập trong tiến trình con | `xlsx-worker.ts` (fork `dist/…/xlsx-worker.js`, `--max-old-space-size=4096`, timeout 10 phút): đọc file tạm → `importXlsx` → `writeWorkbook` → ghi state Yjs ra file tạm, ảnh ra cạnh; API chỉ nạp state (`CollabService.replaceWorkbookState`: xoá 4 map gốc + `Y.applyUpdate` trong **một** transaction, editor đang mở thấy import đến một lần). Dev / test (tsx, chưa build) chạy inline cùng mã. Event loop API không còn bị khoá 20 s; RAM ExcelJS trả lại khi worker thoát. |
| Ảnh nổi | `xlsx-images.ts`: `ws.getImages()` + `book.getImage()` → neo ô (từ `nativeCol/Row` + phần lẻ) → hộp px theo độ rộng cột / cao hàng (mặc định Univer 88 × 24) → asset của spreadsheet (`DocsService.saveAsset`, qua quota §79) → `SHEET_DRAWING_PLUGIN` JSON — Univer lưu **theo khoá sheetId** `{ [sheetId]: { data: { [drawingId]: … }, order: [] } }` (không có tầng unitId; lần đầu tôi viết thừa một tầng → plugin lỗi `order.forEach`, e2e bắt được) — mỗi drawing: `drawingType 0`, `imageSourceType 'URL'`, `transform` px + `sheetTransform` from/to, `anchorType '1'. Client `rekeyDrawings` đổi khoá unitId sang file hiện tại (bản sao / khôi phục / import server). Xuất `.xlsx`: `applyImages` neo lại theo ô (`imageLoader` chỉ lấy asset của chính file). Chỉ PNG / JPEG / GIF (Excel còn EMF/WMF → báo “dropped”). |
| Mở nhanh hơn | `UniverGrid` đếm công thức từ Y.Map trước khi tạo engine: ≤ 20 000 → `FORCED` như cũ (giống Excel fullCalcOnLoad); lớn hơn → `WHEN_EMPTY` (chỉ tính ô công thức chưa có kết quả; kết quả lưu từ Excel / từ client trước vẫn đúng), kèm dải thông báo và **Data → Recalculate all formulas** (`formula.mutation.set-formula-calculation-start` với `forceCalculation`). Thời gian từng pha ghi `window.__moSheetOpen` + `console.debug('[sheets] open')`. |
| Đo (cùng workbook NB) | Trạng thái Yjs **100,5 → 46,2 MB**; `applyUpdate` 3,1 → 1,6 s; RAM API sau nhập **~2,1 GB → 0,94 GB** (ExcelJS ở worker, 1,3–1,7 GB rồi thoát); thời gian nhập qua API ≈ 37 s (như cũ; ExcelJS 21 s là phần chính). Mở trên trình duyệt (dev server): **55 s → 24 s** tới khi tính xong lúc máy rảnh (engine 2,9 s, dựng workbook 3,8 s, tính công thức thiếu 5,9 s, còn lại đồng bộ + giải mã), 37 s khi máy đang tải nặng; heap **1,85 → 0,63–1,02 GB**. Cùng mã client, workbook định dạng cũ (style từng ô) mở 38,8 s. Ảnh: **31/34** vào đúng ô. `scripts/bench-xlsx.ts` in các số này. |
| Kiểm thử | `test/sheets.mjs`: bảng style (ô giữ id, hai ô cùng style chung một id), ảnh nhập thành drawing neo đúng ô E2 + asset tải được + báo cáo “pictures: 1”, ảnh và style **quay lại .xlsx** khi xuất; e2e sheets-flow / sheets-format-flow / macros-flow / macro-triggers-flow chạy lại không đổi. |
| Chưa làm / tiếp theo | Tách Yjs theo sheet (nạp sheet theo nhu cầu) — công thức chéo sheet cần dữ liệu mọi sheet nên Univer vẫn phải có tất cả; nén transport websocket; ExcelJS streaming reader (mất merges / CF / DV) — chưa đáng; ảnh EMF/WMF; tự nén style cho workbook cũ khi mở (hiện là script). |

## 84. Đóng gói mã nguồn mở: Docker một lệnh, reverse proxy, giấy phép, CI: quyết định

Yêu cầu (2026-10-09): để người khác tải về chạy được (mục tiêu nhóm ≈20 người, mã nguồn mở).

| Vấn đề | Quyết định |
|---|---|
| Một lệnh | `infra/docker-compose.prod.yml` + `.env.production.example`: `proxy` (Caddy), `web`, `api`, `postgres`, `redis`, `s3` (SeaweedFS), profile `ai` (Ollama). `docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build`. Migration chạy mỗi lần `api` khởi động (`migrate.ts` tìm thư mục `drizzle` cả khi chạy từ `dist`), `GET /health` (CSDL trả lời → 200) là healthcheck; `web` chờ `api` healthy. Thiết lập lần đầu qua `/setup` (§79) — không cần seed. |
| Một địa chỉ | Trình duyệt chỉ nói với Caddy: `/` → web, `/api/*` → api:4000 (bỏ tiền tố; REST, tải lên, **websocket realtime** `/api/realtime`), `/collab*` → api:4001 (Hocuspocus), `/pub/*` → api. Vì thế ảnh web được build với `NEXT_PUBLIC_API_URL=/api` (đường dẫn tương đối) và `apiWsOrigin()` dựng URL websocket tuyệt đối từ `window.location`; `COLLAB_PUBLIC_URL=${PUBLIC_WS_URL}/collab`. `PUBLIC_HOST=:80` (HTTP, mọi tên) hoặc tên miền → Caddy tự lấy chứng chỉ. Next rewrite `/api` vẫn còn (đích `API_URL=http://api:4000`) cho trường hợp chạy web không qua Caddy. |
| Ảnh Docker | `apps/api/Dockerfile`: multi-stage, `node:22-bookworm-slim`, pnpm 9.15 (hoisted như repo), `pnpm install --filter @workos/api...`, `nest build`, ảnh chạy cài `--prod` + **Chromium của Playwright** (xuất PDF / ảnh slide), copy `drizzle`; user `node`; volume `api-cache` (tessdata), `SETTINGS_KEY` bắt buộc (không dùng file `.secrets`). `apps/web/Dockerfile`: `next build` với `output: 'standalone'` (bật khi `NODE_ENV=production`), copy `standalone` + `static` + `public`, chạy `node apps/web/server.js`. `.dockerignore` loại node_modules, dist, .next, ảnh tham chiếu, .env. |
| Giấy phép | **MIT** (`LICENSE`) — chọn mặc định phổ biến nhất; đổi sang AGPL nếu muốn bắt buộc chia sẻ sửa đổi khi host dịch vụ. |
| Tài liệu | `README.md` viết lại (tổng quan, chạy thử, bảng tính năng, cấu trúc), `docs/INSTALL.md` (Docker, địa chỉ / HTTPS, tuỳ chọn mail / TURN / AI / S3 ngoài, vận hành, sao lưu, bảng biến môi trường, giới hạn), `CONTRIBUTING.md`, `.env.example` bổ sung biến tuỳ chọn. |
| CI | `.github/workflows/ci.yml`: pnpm install, typecheck, test mô hình không cần server (base-model, photodeck), `docker compose config` với file ví dụ, build hai ảnh Docker (cache GHA). Test API / e2e cần Postgres + S3 + Ollama — chưa đưa vào CI. |
| Review chéo (Claude + ChatGPT, 2026-10-09) | Sửa trước khi phát hành: `migrate.ts` tìm `drizzle` **năm** cấp trên `dist/apps/api/src/db` (trước đó bốn → container không lên); ảnh API cài deps bằng `--filter '!@workos/web'` vì `@workos/api...` bỏ sót tiptap / katex của `packages/*` (API không khai báo `@workos/*` là dependency); Chromium cài vào `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` (cài khi là root rồi chạy bằng `node` → không tìm thấy trình duyệt) và lấy đúng phiên bản trong lockfile qua `pnpm exec playwright`; `POSTGRES_PASSWORD` / `S3_SECRET_KEY` bắt buộc đặt (không còn mặc định `workos`); Redis và S3 có healthcheck, `api` chờ `service_healthy`; `.dockerignore` loại mọi `.env*` trừ hai file ví dụ. Ảnh màn hình cho README: `docs/screenshots/*.png` (1600 px), bản 2× ở `/screenshots` (gitignore). |
| Chưa làm | Nhiều tiến trình API (Hocuspocus cần Redis extension); `.xls/.ods` (LibreOffice); ảnh Docker chưa đẩy lên registry; gói `@workos/*` chưa tách thành thư viện riêng. |

## 85. Chất lượng vận hành: log + xử lý lỗi, bảo mật, hiệu năng: kế hoạch và quyết định

Yêu cầu (2026-10-10, sau khi mở mã nguồn): mọi thứ phải ghi log và xử lý ngoại lệ (kể cả lỗi của message / thông báo), tối ưu tốc độ xử lý, mở và lưu file, vá lỗ hổng bảo mật. Ba cuộc rà soát độc lập (log/lỗi, hiệu năng, bảo mật) được làm trước; kết quả và thứ tự xử lý:

| Đợt | Nội dung | Trạng thái |
|---|---|---|
| **A. Log + ngoại lệ** | `common/errors.ts`: `HttpErrorFilter` toàn cục (HttpException giữ nguyên; Postgres 23505→409, 23503→409, 22P02/23502/23514→400, deadlock/timeout→503; S3 NoSuchKey→404; upload quá cỡ→413; lỗi lạ→500 kèm **mã tham chiếu** `ref` in cả vào log lẫn câu trả lời), `requestLog` (một dòng mỗi request: 4xx + chậm >3 s ở warn, còn lại debug; production mặc định không in debug, `LOG_LEVEL=debug` để bật), `installProcessHandlers` (unhandledRejection ghi log; uncaughtException ghi log rồi thoát để supervisor khởi động lại), `swallow(log, việc)` thay cho `.catch(() => undefined)` ở các tác vụ phụ (thông báo chat, mail mời họp, sau duyệt, quét phòng họp, nhập file). Realtime: handler đồng bộ ném lỗi không làm rơi socket, `ws.on('error')`, token hỏng không ném. Flow runner: `tick` có catch, `walkSafely` kết thúc run khi điều kiện / template / DB ném lỗi, run `running` lúc khởi động → `failed` "Interrupted by a server restart". Mail: `attempts` + `updated_at` (migration 0034), timeout SMTP 10/10/30 s, vòng thử lại mỗi phút (queued kẹt >2 phút hoặc failed, tối đa 3 lần). Storage: chỉ coi 404 là "chưa có", lỗi khác ném; bucket không tới được → thông báo rõ khi khởi động. `pipeStream` cho mọi stream tải về (lỗi giữa chừng → 502 hoặc đóng, không còn unhandled 'error'). DocStore: backlink / activity / snapshot tự động là việc phụ, không chặn việc lưu. Collab: lỗi load/save được ghi (Hocuspocus `quiet`). AI: job queued/running lúc khởi động → failed. Web: `error.tsx`, `global-error.tsx`, `not-found.tsx`; `api()` bọc lỗi mạng thành `ApiError(0, 'The server cannot be reached')`; React Query `MutationCache`/`QueryCache` báo toast (một lần cho mỗi thông điệp trong 4 s) cho mutation không tự xử lý và query nền thất bại; `unhandledrejection` toàn cục; realtime: mỗi handler trong try/catch, kết nối lại nạp lại chat/notifications/mail/calendar/tasks/approvals/meetings; collab token lỗi → hiện lỗi thay vì kết nối lại âm thầm. | **xong** |
| **B. Bảo mật 1 (nghiêm trọng / cao)** | (1) Trigger của Flow phải được **uỷ quyền theo nguồn sự kiện**: `mail.received` chỉ với mailbox chủ flow đọc được, `form.submitted` / `base.*` / `approval.*` / `task.*` kiểm tra quyền của chủ flow trên form / base / template / project; trigger rỗng không còn khớp mọi thứ. (2) Webhook của Flow: chặn IP riêng / link-local / tên dịch vụ nội bộ sau khi **phân giải DNS**, không theo redirect, timeout. (3) Form → Sheets: `appendRows` kiểm tra chủ form có quyền sửa sheet. (4) Production guard: từ chối khởi động khi `COLLAB_SECRET` / `SETTINGS_KEY` là giá trị mẫu, `AUTH_DEV` không bật được trong production, `MAIL_INBOUND_SECRET` không có mặc định. (5) Header bảo mật: `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors` cho app, `Content-Security-Policy: sandbox` cho `/pub` và file xem inline; chỉ cho inline với allowlist MIME (ảnh, PDF, video, audio, text/plain), SVG và HTML luôn tải về. (6) PDF renderer: chặn mọi request mạng ngoài asset nội bộ, tắt JavaScript. (7) `trust proxy`, throttling đăng nhập theo IP + email (không khoá toàn cục), rate limit cho /setup, reset, invite, form công khai, runNow. (8) CORS localhost chỉ ngoài production; `/meetings/config` cần đăng nhập; `/health` không lộ thông điệp DB. | **xong** — `flow-runner.authorized()` kiểm tra quyền chủ flow trên form / bảng Base / request duyệt / project / mailbox trước mỗi lần kích hoạt (test: flow của Hana không nhận câu trả lời của form HR); `common/ssrf.ts` (`assertPublicUrl`: chặn loopback / private / link-local / CGNAT / multicast, tên một nhãn như `s3`, `ollama`, tên phân giải ra địa chỉ riêng; không theo redirect; chỉ GET/POST/PUT/PATCH/DELETE); form → sheet chỉ khi chủ form là editor của sheet; `assertProductionConfig()` từ chối khởi động production với `COLLAB_SECRET` mẫu hoặc `AUTH_DEV=1` (và `config.auth.dev` luôn false ở production); `securityHeaders` (nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy) + Next `headers()` (nosniff, Permissions-Policy, X-Frame-Options trừ /f, /bf, /pub); `inlineAllowed()` — chỉ ảnh (không SVG), PDF, video, audio, text/plain, csv, json được xem inline, còn lại luôn tải về; `sandboxInline()` (`CSP: sandbox`) cho asset tài liệu, file inline và HTML xuất; trang xuất bản `/pub` chạy trong `sandbox allow-scripts allow-popups allow-forms` (origin riêng, không dùng được session); PDF renderer chặn mọi request mạng (chỉ data:/blob:) và tắt JavaScript trừ khi cần đánh số dòng; `trust proxy`; `RateLimitGuard` + `@RateLimit(max, giây)` cho login 10/phút, forgot 5/10 phút, reset 10/10 phút, setup 5/10 phút, nhận lời mời 10/10 phút, trả lời form 30/phút, upload form 20/phút, hỏi Q&A 30/phút, vote 60/phút, chạy trigger ngay 20/phút; bảng throttle đăng nhập được dọn; CORS localhost chỉ ngoài production; `/meetings/config` cần đăng nhập; `/health` không lộ thông điệp DB. |
| **C. Bảo mật 2** | Escape thuộc tính style/số trong HTML sinh từ Yjs (doc-model `blockAttrs`, sheets `styleCss`, slide-model `render.ts`), `javascript:` bị loại ở link/ảnh (doc-model, `markdownToHtml`), `mailHtml` escape màu, URL thông báo chỉ cùng origin, macro sandbox chạy trong worker thread có giới hạn đồng thời, upload form kiểm tra cỡ trước khi đệm, CSV export trung hoà công thức, `sendCopy` chỉ gửi tới người trả lời đã đăng nhập hoặc địa chỉ đã xác nhận, SPF/DKIM cho mail đến (tuỳ chọn). | chờ |
| **D. Hiệu năng 1 (mở / lưu / liệt kê)** | Bỏ `SELECT *` trên `resources` ở permission check và listing (không kéo `content_text`), memo quyền theo request (`spaceRoles` một lần), index: `audit_events (workspace_id, created_at)`, `resource_access (user_id, accessed_at)`, `resources (workspace_id, type, updated_at)`, expression index cho `metadata->'publish'->>'token'`, `tasks (sprint_id)`, `tasks (created_by)`, `outbox (published_at)`, pg_trgm cho tìm kiếm; collab token lấy một lần; DocStore: bỏ qua lưu khi state không đổi, `syncLinks` chỉ khi link đổi; mail `threadSummaries` giới hạn trước khi gộp; calendar lọc theo thời gian trước; debounce tìm kiếm ở mọi hộp tìm. | chờ |
| **E. Hiệu năng 2 (tải trang, upload)** | `EditorShell` nạp từng workspace bằng `next/dynamic`; `markdownToHtml` import trực tiếp (không kéo TipTap/KaTeX vào shell); virtualization cho Drive / Chat / Mail / Tasks; upload stream lên S3 + nhập Office ở job nền (trả lời ngay, trạng thái qua realtime); thumbnail ảnh; `permessage-deflate` cho realtime; `loading="lazy"` cho ảnh. | chờ |

Nguyên tắc chung: lỗi của việc **chính** (lưu nội dung, gửi tin, tạo bản ghi) phải nổi lên tới người dùng với thông điệp có nghĩa; lỗi của việc **phụ** (thông báo, backlink, snapshot, thư mời) chỉ ghi log ở warn và không làm hỏng việc chính; mọi job nền phải có trạng thái cuối (không còn hàng kẹt `queued`/`running`); mọi `catch` phải hoặc xử lý, hoặc ghi log, không im lặng.

