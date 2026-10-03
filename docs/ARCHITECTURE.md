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
| 5 | Chat (conversation, message, resource card, WS) + Notifications | |
| 6 | Search (OpenSearch, outbox, indexer) + AI layer | |
| 7 | Calendar, Meetings, Tasks (Board/List/Timeline/Gantt/Dashboard), Flow designer, Base, Approvals, Contacts, Admin, Analytics, M365 connector | |

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
| Giới hạn | Chưa có QR code, nhập câu hỏi từ form khác, thông báo email khi có câu trả lời (chờ module Mail), chấm điểm tay câu tự luận, "chỉ 1 câu trả lời" cho form công khai (cần đăng nhập). |
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
