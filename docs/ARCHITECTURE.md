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
