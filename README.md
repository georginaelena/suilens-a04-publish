# SuiLens Microservices Workspace

Workspace ini berisi frontend observability dashboard dan empat backend service yang saling terhubung melalui HTTP dan event RabbitMQ.

## Ringkasan Arsitektur

Komponen utama:
- Frontend (Vue + Vuetify): dashboard katalog, inventory, order, dan notifikasi realtime.
- Catalog Service: sumber data lensa.
- Inventory Service: stok per cabang + reservasi/release stok.
- Order Service: pembuatan order, validasi katalog, reservasi inventory, publish event.
- Notification Service: konsumsi event order dari RabbitMQ, simpan riwayat, broadcast WebSocket.
- Infrastruktur: 4 Postgres terpisah (per service) + RabbitMQ.

Alur bisnis inti:
1. Frontend membuat order ke Order Service.
2. Order Service validasi lens ke Catalog Service.
3. Order Service reserve stok ke Inventory Service.
4. Jika sukses, order disimpan lalu event order.placed dipublish ke RabbitMQ.
5. Notification Service konsumsi event, simpan notifikasi, lalu kirim realtime ke klien WebSocket.

## Struktur Folder

- frontend/suilens-frontend: aplikasi frontend.
- services/catalog-service: API katalog lensa.
- services/inventory-service: API inventory dan reservasi.
- services/order-service: API order + publisher event.
- services/notification-service: API riwayat notifikasi + WebSocket + consumer event.
- docker-compose.yml: orkestrasi seluruh stack.

## Prasyarat

Untuk menjalankan via Docker Compose:
- Docker
- Docker Compose

Untuk menjalankan lokal tanpa Docker (opsional):
- Bun (disarankan v1.3+)
- Node.js + pnpm untuk frontend
- PostgreSQL dan RabbitMQ lokal (atau gunakan container untuk infra)

## Menjalankan Seluruh Stack (Direkomendasikan)

Dari root project:

1. Build dan start semua service:
```
docker compose up --build
```

2. Akses aplikasi:
- Frontend: http://localhost:5173
- Catalog API: http://localhost:3001
- Order API: http://localhost:3002
- Notification API: http://localhost:3003
- Inventory API: http://localhost:3004
- RabbitMQ Management: http://localhost:15672 (guest/guest)

3. Stop stack:
```
docker compose down
```
4. Stop dan hapus volume database:
```
docker compose down -v
```
Catatan:
- Setiap backend service menjalankan migrasi schema otomatis saat startup.
- Catalog dan Inventory juga melakukan seed data otomatis saat startup.

## Menjalankan Service Secara Lokal (Tanpa Docker Compose)

### 1) Catalog Service

Masuk ke services/catalog-service lalu jalankan:
- bun install
- ./start.sh

Port default: 3001

### 2) Inventory Service

Masuk ke services/inventory-service lalu jalankan:
- bun install
- ./start.sh

Port default: 3004

### 3) Order Service

Masuk ke services/order-service lalu jalankan:
- bun install
- ./start.sh

Port default: 3002

### 4) Notification Service

Masuk ke services/notification-service lalu jalankan:
- bun install
- ./start.sh

Port default: 3003

### 5) Frontend

Masuk ke frontend/suilens-frontend lalu jalankan:
- pnpm install
- pnpm dev

Port default: 5173

## Environment Variables

### Frontend
- VITE_CATALOG_API (default: http://localhost:3001)
- VITE_INVENTORY_API (default: http://localhost:3004)
- VITE_ORDER_API (default: http://localhost:3002)
- VITE_NOTIFICATION_API (default: http://localhost:3003)
- VITE_NOTIFICATION_WS (default: ws://localhost:3003/ws/notifications)

### Catalog Service
- DATABASE_URL
- SERVICE_NAME
- OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

### Inventory Service
- DATABASE_URL
- CATALOG_SERVICE_URL
- SERVICE_NAME
- OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

### Order Service
- DATABASE_URL
- CATALOG_SERVICE_URL
- INVENTORY_SERVICE_URL
- DEFAULT_BRANCH_CODE
- RABBITMQ_URL
- SERVICE_NAME
- OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

### Notification Service
- DATABASE_URL
- RABBITMQ_URL
- SERVICE_NAME
- OTEL_EXPORTER_OTLP_TRACES_ENDPOINT

## Endpoint

### Catalog Service (3001)
- GET /api/lenses
- GET /api/lenses/:id
- GET /docs
- GET /health

### Inventory Service (3004)
- GET /api/branches
- GET /api/inventory/lenses/:lensId
- POST /api/inventory/reserve
- POST /api/inventory/release
- GET /docs
- GET /health

### Order Service (3002)
- POST /api/orders
- GET /api/orders
- GET /api/orders/:id
- GET /docs
- GET /health

### Notification Service (3003)
- GET /api/notifications
- WS /ws/notifications
- GET /docs
- GET /health

## Observability Assignment (Monitoring, Logging, Tracing)

Implementasi observability pada project ini mengikuti benchmark pola yang sama dengan tutorial di folder sibling `demo-helpdesk`:
- Prometheus + Grafana untuk monitoring dan dashboard.
- ELK (Filebeat + Logstash + Elasticsearch + Kibana) untuk centralized logging.
- OpenTelemetry + Jaeger untuk distributed tracing.

### Cakupan Requirement Tugas

1. Monitoring dashboard visual
- Metrik request rate: `suilens_http_requests_total`.
- Metrik latency: `suilens_http_request_duration_seconds` (grafik p95).
- Metrik error rate: dihitung dari rasio status 5xx terhadap total request.
- Metrik bisnis:
	- `suilens_orders_total` (success/failed).
	- `suilens_inventory_reservations_total` (success/failed + reason).
	- `suilens_notifications_total`.

2. Centralized logging lintas service
- Semua service backend mengeluarkan structured JSON logs ke stdout.
- Field utama log: `timestamp`, `service`, `level`, `message`, `trace_id`, `span_id`, `correlation_id`, dll.
- Filebeat mengambil container logs -> Logstash parse JSON -> Elasticsearch index `suilens-logs-*` -> visualisasi di Kibana.

3. Distributed tracing end-to-end
- Flow utama yang bisa ditelusuri di Jaeger: `POST /api/orders`.
- Rantai trace:
	- inbound order-service,
	- outbound order-service -> catalog-service,
	- outbound order-service -> inventory-service,
	- publish event `order.placed` ke RabbitMQ,
	- consume event di notification-service.
- Propagasi context menggunakan W3C trace context (`traceparent`) + `x-correlation-id`.

## Arsitektur Observability

Tambahan komponen di `docker-compose.yml`:
- `prometheus` (port host `9091`).
- `grafana` (port host `3005`, default login `admin/admin`).
- `jaeger` (UI di `http://localhost:16687`).
- `elasticsearch` (port host `9201`).
- `kibana` (port host `5602`).
- `logstash` + `filebeat`.

Konfigurasi observability tersimpan di folder:
- `observability/prometheus/prometheus.yml`
- `observability/grafana/provisioning/*`
- `observability/grafana/dashboards/suilens-observability.json`
- `observability/filebeat/filebeat.yml`
- `observability/logstash/pipeline/logstash.conf`

## Tutorial Menjalankan dan Verifikasi

### 1) Jalankan Semua Service

```bash
docker compose up --build
```

### 2) Akses Dashboard dan Tools

- Frontend: `http://localhost:5173`
- Grafana: `http://localhost:3005`
- Prometheus: `http://localhost:9091`
- Jaeger: `http://localhost:16687`
- Kibana: `http://localhost:5602`

### 3) Generate Request (Untuk Monitoring + Logging + Tracing)

Ambil `lensId` terlebih dahulu:

```bash
curl -s http://localhost:3001/api/lenses
```

Contoh create order (flow trace utama):

```bash
curl -X POST http://localhost:3002/api/orders \
	-H 'Content-Type: application/json' \
	-H 'x-correlation-id: assignment-a04-001' \
	-d '{
		"customerName": "A04 Tester",
		"customerEmail": "a04@test.local",
		"lensId": "REPLACE_WITH_REAL_LENS_ID",
		"branchCode": "KB-JKT-S",
		"startDate": "2026-03-30",
		"endDate": "2026-04-02"
	}'
```

Load sederhana untuk menaikkan metric:

```bash
for i in $(seq 1 20); do
	curl -s http://localhost:3002/api/orders >/dev/null
done
```

### 4) Bukti yang Perlu Diambil Screenshot

- Grafana dashboard:
	- request rate,
	- latency p95,
	- error rate,
	- business metrics.
- Kibana Discover:
	- filter `service_name` per service,
	- tampilkan `correlation_id`, `trace_id`, `message`.
- Jaeger:
	- trace untuk flow `POST /api/orders` yang menyentuh >1 service.

### 5) Endpoint Metrics per Service

- Catalog: `http://localhost:3001/metrics`
- Inventory: `http://localhost:3004/metrics`
- Order: `http://localhost:3002/metrics`
- Notification: `http://localhost:3003/metrics`

## Catatan Benchmark vs Tutorial

- Struktur observability stack meniru tutorial `demo-helpdesk` agar konsisten dengan materi perkuliahan.
- Perbedaannya: implementasi metrik bisnis disesuaikan domain SuiLens (`orders`, `inventory reservation`, `notification`) dan tracing menargetkan flow lintas microservice + message broker.

## Panduan Menyusun PDF Laporan (Siap Pakai)

Bagian ini dibuat supaya kamu bisa langsung menjawab semua poin tugas secara sistematis.

### A. Struktur Dokumen PDF yang Disarankan

Gunakan urutan bab berikut:

1. Cover
- Judul: Assignment 4 Observability - SuiLens
- Nama
- NPM
- Mata kuliah

2. Ringkasan Tugas
- Jelaskan bahwa target observability mencakup monitoring, centralized logging, dan distributed tracing pada arsitektur microservices SuiLens.

3. Gambaran Solusi dan Arsitektur
- Tools yang dipakai:
	- Monitoring: Prometheus + Grafana
	- Logging: Filebeat + Logstash + Elasticsearch + Kibana
	- Tracing: OpenTelemetry + Jaeger
- Jelaskan arsitektur singkat aliran data observability:
	- Metrics: service -> /metrics -> Prometheus -> Grafana
	- Logs: stdout container -> Filebeat -> Logstash -> Elasticsearch -> Kibana
	- Traces: service -> OTLP -> Jaeger

4. Langkah Implementasi Garis Besar
- Monitoring:
	- Tambah endpoint `/metrics` pada service backend.
	- Tambah metrik request count, latency histogram, error rate basis 5xx, dan metrik bisnis.
	- Buat dashboard Grafana.
- Logging:
	- Terapkan structured logging JSON di lebih dari satu service.
	- Sertakan field investigasi: timestamp, service, level, message, endpoint/route, correlation_id, trace_id.
	- Kirim ke stack ELK.
- Tracing:
	- Instrumentasi inbound request dan outbound call antar service.
	- Propagasi trace context dan correlation id.
	- Instrumentasi publish-consume event RabbitMQ untuk flow lintas service.

5. Cara Menjalankan Sistem
- Sertakan command utama:
	- `docker compose up --build`
- Sertakan URL:
	- Frontend, Grafana, Prometheus, Kibana, Jaeger
- Sertakan cara generate request (curl create order + correlation id)

6. Bukti Implementasi (Screenshot)
- Monitoring:
	- Panel request rate
	- Panel latency p95
	- Panel error rate
	- Panel metrik bisnis
- Logging:
	- Kibana Discover menampilkan log dari minimal 2 service
	- Bukti field `correlation_id`, `trace_id`, `service_name`, `message`
- Tracing:
	- Jaeger trace untuk flow `POST /api/orders`
	- Span minimal: order-service, catalog-service, inventory-service, dan consumer notification-service

7. Penjelasan Hasil
- Jelaskan arti masing-masing metrik.
- Jelaskan bagaimana log dipakai untuk investigasi insiden.
- Jelaskan urutan flow trace end-to-end dari request masuk hingga event diproses.

8. Kesimpulan
- Nyatakan bahwa tiga objective observability sudah tercapai.
- Sebutkan manfaat yang didapat: visibilitas performa, debugging lebih cepat, dan trace lintas service.

### B. Template Narasi Jawaban (Bisa Langsung Dipakai)

#### 1) Gambaran Solusi

"Pada assignment ini, observability diimplementasikan pada aplikasi SuiLens berbasis microservices menggunakan tiga pilar utama: monitoring, logging, dan tracing. Untuk monitoring digunakan Prometheus sebagai collector metrics dan Grafana sebagai dashboard visual. Untuk centralized logging digunakan pipeline Filebeat -> Logstash -> Elasticsearch dengan visualisasi di Kibana. Untuk distributed tracing digunakan OpenTelemetry pada service backend dengan collector Jaeger untuk visualisasi trace lintas service." 

#### 2) Langkah Implementasi Garis Besar

"Implementasi dimulai dengan menambahkan endpoint metrics pada service backend dan menginstrumentasi metrik request serta metrik bisnis. Selanjutnya logging backend diubah menjadi structured JSON agar dapat diproses terpusat oleh ELK stack. Terakhir, tracing ditambahkan pada inbound request, outbound HTTP call, serta publish-consume event RabbitMQ, sehingga flow create order dapat ditelusuri end-to-end." 

#### 3) Cara Menjalankan dan Generate Request

"Sistem dijalankan dengan Docker Compose menggunakan perintah docker compose up --build. Setelah seluruh service aktif, request create order dikirim ke order-service dengan header correlation id. Request ini digunakan untuk menghasilkan data metrik, log, dan trace agar dapat diverifikasi di Grafana, Kibana, dan Jaeger." 

#### 4) Penjelasan Monitoring

"Dashboard monitoring menampilkan empat indikator utama: jumlah request, latency p95, error rate berbasis status 5xx, dan metrik bisnis (misalnya jumlah order sukses/gagal, inventory reservation, dan notifikasi). Dengan panel ini, performa sistem dan kondisi bisnis dapat dipantau secara real-time." 

#### 5) Penjelasan Logging

"Centralized logging menunjukkan log dari beberapa service dalam satu tempat. Format log JSON memuat timestamp, service name, level, message, correlation id, dan trace id. Informasi ini memudahkan investigasi karena satu request dapat ditelusuri lintas service menggunakan correlation id atau trace id yang sama." 

#### 6) Penjelasan Tracing

"Distributed tracing memvisualisasikan flow create order dari order-service ke catalog-service, inventory-service, publish event RabbitMQ, hingga diproses notification-service. Dengan trace ini, durasi tiap span dan titik bottleneck dapat diidentifikasi dengan jelas." 

### C. Checklist Final Sebelum Submit

Pastikan semua ini ada sebelum membuat ZIP:

- PDF laporan sudah memuat semua poin A sampai H di atas.
- Screenshot monitoring, logging, dan tracing sudah jelas terbaca.
- Nama file PDF sesuai format: `NAMA_NPM.pdf`.
- ZIP berisi codebase yang sudah dimodifikasi + PDF.
- Jangan sertakan folder `node_modules` di ZIP.
- Nama ZIP sesuai format: `NAMA_NPM.zip`.

### D. Tips Supaya Penilaian Aman

- Pakai satu `correlation_id` yang konsisten saat demo request supaya pembuktian log dan trace mudah.
- Ambil screenshot setelah generate request minimal 1-3 kali agar panel tidak kosong.
- Di bagian penjelasan, fokus pada alasan teknis dan manfaat, bukan hanya daftar tools.

## Tutorial Penggunaan Aplikasi (Step-by-Step + Checklist Screenshot)

Section ini fokus untuk praktik dan pengambilan bukti implementasi. Ikuti urutan dari awal sampai akhir.

### 0) Kondisi Awal

Pastikan:
- Docker Desktop aktif.
- Port berikut tidak dipakai aplikasi lain: `3001`, `3002`, `3003`, `3004`, `3005`, `5173`, `5602`, `9091`, `16687`.

### 1) Jalankan Seluruh Stack

Di root project jalankan:

```bash
docker compose up --build
```

Jika sudah pernah build dan ingin cepat:

```bash
docker compose up -d
```

Cek status service:

```bash
docker compose ps
```

Yang harus status `Up`:
- frontend
- catalog-service
- inventory-service
- order-service
- notification-service
- prometheus
- grafana
- jaeger
- elasticsearch
- kibana
- filebeat
- logstash

Screenshot yang diambil:
- Output `docker compose ps` (bukti semua service hidup).

### 2) Buka Semua URL Penting

Gunakan URL berikut:
- Frontend: `http://localhost:5173`
- Grafana: `http://localhost:3005` (login `admin/admin`)
- Prometheus: `http://localhost:9091`
- Kibana: `http://localhost:5602`
- Jaeger: `http://localhost:16687`

Screenshot yang diambil:
- Halaman Grafana terbuka.
- Halaman Kibana terbuka.
- Halaman Jaeger terbuka.

### 3) Verifikasi API Dasar (Health + Data)

Jalankan:

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3004/health
curl -s http://localhost:3002/health
curl -s http://localhost:3003/health
curl -s http://localhost:3001/api/lenses
```

Tujuan:
- Memastikan backend siap.
- Mengambil `lensId` untuk testing create order.

Screenshot yang diambil:
- Output health check.
- Output daftar lenses (terlihat ada `id`).

### 4) Generate Traffic Utama (Flow Create Order)

Pilih salah satu `lensId` dari langkah sebelumnya, lalu kirim request berikut:

```bash
curl -X POST http://localhost:3002/api/orders \
	-H 'Content-Type: application/json' \
	-H 'x-correlation-id: assignment-a04-001' \
	-d '{
		"customerName": "A04 Tester",
		"customerEmail": "a04@test.local",
		"lensId": "REPLACE_WITH_REAL_LENS_ID",
		"branchCode": "KB-JKT-S",
		"startDate": "2026-04-01",
		"endDate": "2026-04-03"
	}'
```

Ulangi 2-3 kali dengan correlation id berbeda agar grafik lebih jelas:

```bash
curl -X POST http://localhost:3002/api/orders -H 'Content-Type: application/json' -H 'x-correlation-id: assignment-a04-002' -d '{...}'
curl -X POST http://localhost:3002/api/orders -H 'Content-Type: application/json' -H 'x-correlation-id: assignment-a04-003' -d '{...}'
```

Screenshot yang diambil:
- Response sukses create order (berisi `id`, `totalPrice`, dll).

### 5) Cek Monitoring di Grafana

Masuk Grafana -> Dashboard `SuiLens Observability Dashboard`.

Panel yang perlu kamu tunjukkan:
- Request rate per service.
- Latency p95 per service.
- Error rate (5xx).
- Business metrics (`suilens_orders_total`, `suilens_inventory_reservations_total`, `suilens_notifications_total`).

Jika panel masih sepi:
- Ulangi request create order.
- Refresh dashboard.
- Ubah time range ke `Last 30 minutes`.

Screenshot yang diambil:
- 1 screenshot full dashboard.
- Atau 4 screenshot terpisah sesuai panel requirement.

### 6) Cek Metrics Mentah di Prometheus (Opsional tapi Bagus untuk Laporan)

Buka Prometheus dan coba query:

```text
sum(rate(suilens_http_requests_total[1m])) by (service)
histogram_quantile(0.95, sum(rate(suilens_http_request_duration_seconds_bucket[5m])) by (le, service))
sum(rate(suilens_http_requests_total{status=~"5.."}[5m])) by (service) / sum(rate(suilens_http_requests_total[5m])) by (service)
sum(suilens_orders_total) by (status)
```

Screenshot yang diambil:
- Minimal 1 query hasil metrics (untuk memperkuat analisis teknis).

### 7) Cek Centralized Logging di Kibana

Langkah:
1. Buka Kibana -> Discover.
2. Pilih data view index `suilens-logs-*` (buat jika belum ada).
3. Filter contoh:
	 - `service_name : "order-service"`
	 - `service_name : "notification-service"`
	 - `app.correlation_id : "assignment-a04-001"` (jika field tersedia di mapping)

Field log penting yang harus terlihat:
- `@timestamp`
- `service_name`
- `log_level`
- `message`
- `app.trace_id` / `trace_id`
- `app.correlation_id` / `correlation_id`

Screenshot yang diambil:
- Log dari minimal 2 service di tempat yang sama.
- Bukti 1 correlation id yang bisa diikuti lintas service.

### 8) Cek Distributed Tracing di Jaeger

Langkah:
1. Buka Jaeger UI.
2. Pilih service `order-service`.
3. Operation: `POST /api/orders` (atau nama span sejenis).
4. Klik `Find Traces`.
5. Buka salah satu trace hasil create order terbaru.

Yang harus terlihat dalam trace:
- Span inbound request di order-service.
- Span outbound ke catalog-service.
- Span outbound ke inventory-service.
- Span event publish/consume sampai notification-service.

Screenshot yang diambil:
- 1 screenshot list traces.
- 1 screenshot detail trace (tree span lengkap).

### 9) Cek Frontend (Bukti Fungsional Aplikasi)

Di frontend:
- Buat order dari form.
- Lihat notifikasi realtime muncul.

Screenshot yang diambil:
- Halaman dashboard frontend.
- Bukti notifikasi realtime.

### 10) Checklist Screenshot Final (Minimal)

Wajib:
- `docker compose ps` semua service `Up`.
- Grafana dashboard (request, latency, error rate, business metric).
- Kibana log terpusat dari >=2 service dengan field investigasi.
- Jaeger trace flow create order lintas service.

Disarankan tambahan:
- Output curl create order.
- Prometheus query result.
- Frontend realtime notification.

### 11) Troubleshooting Singkat Saat Demo

Jika service tidak `Up`:

```bash
docker compose logs --tail=100 <nama-service>
```

Jika panel Grafana kosong:
- Pastikan request sudah digenerate.
- Pastikan target Prometheus `UP` di `Status -> Targets`.

Jika Kibana belum ada log:
- Tunggu 10-30 detik setelah generate request.
- Cek `filebeat` dan `logstash` status di `docker compose ps`.

Jika Jaeger belum ada trace:
- Generate ulang `POST /api/orders` dengan `x-correlation-id`.
- Pastikan service backend tidak restart/error.

## Audit Pra-Submit (PASS/FAIL)

Gunakan tabel ini sebelum finalisasi PDF dan ZIP.

### 1) Monitoring

- [ ] PASS jika panel request rate tampil dan nilainya berubah setelah generate request.
- [ ] PASS jika panel latency p95 tampil (bukan no data).
- [ ] PASS jika panel error rate tampil.
- [ ] PASS jika minimal satu metrik bisnis tampil (`orders`, `reservations`, atau `notifications`).

### 2) Centralized Logging

- [ ] PASS jika log dari minimal 2 service muncul di Kibana Discover.
- [ ] PASS jika log memuat field investigasi (`timestamp`, `service_name`, `message`, `log_level`).
- [ ] PASS jika `correlation_id` atau `trace_id` dapat dipakai untuk menelusuri kejadian.

### 3) Distributed Tracing

- [ ] PASS jika trace `POST /api/orders` terlihat di Jaeger.
- [ ] PASS jika trace melibatkan lebih dari 1 service.
- [ ] PASS jika trace menunjukkan alur create order end-to-end (request masuk, downstream call, event processing).

### 4) Operasional Sistem

- [ ] PASS jika `docker compose ps` menunjukkan semua service utama `Up`.
- [ ] PASS jika endpoint health service backend merespons `status: ok`.

### 5) Dokumentasi Laporan

- [ ] PASS jika PDF memuat: arsitektur solusi, langkah implementasi, cara run, bukti screenshot, penjelasan metrik/log/trace.
- [ ] PASS jika nama file PDF `NAMA_NPM.pdf`.
- [ ] PASS jika ZIP `NAMA_NPM.zip` tanpa `node_modules`.

## Template Caption Screenshot (Siap Tempel ke PDF)

Gunakan format caption berikut agar laporan konsisten:

1. `Gambar X. Status seluruh container menggunakan docker compose ps (semua service observability dan aplikasi dalam keadaan Up).`
2. `Gambar X. Dashboard Grafana menampilkan request rate, latency p95, error rate, dan metrik bisnis SuiLens.`
3. `Gambar X. Kibana Discover menampilkan centralized structured logs dari order-service dan notification-service.`
4. `Gambar X. Log dengan correlation_id yang sama pada beberapa service untuk kebutuhan investigasi lintas service.`
5. `Gambar X. Jaeger menampilkan distributed trace flow POST /api/orders melintasi beberapa service.`
6. `Gambar X. Frontend SuiLens saat melakukan create order dan menerima update notifikasi.`

## Urutan Pengambilan Screenshot Paling Cepat (10-15 Menit)

1. Ambil SS `docker compose ps`.
2. Kirim 1-3 request `POST /api/orders` dengan correlation id.
3. Ambil SS Grafana dashboard.
4. Ambil SS Kibana Discover (2 service + field investigasi).
5. Ambil SS Jaeger (trace list + detail trace).
6. Ambil SS frontend (opsional namun disarankan).

Jika keenam langkah di atas sudah lengkap, secara praktis bukti untuk semua kriteria tugas sudah aman.
