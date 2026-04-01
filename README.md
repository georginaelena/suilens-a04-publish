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

### Inventory Service
- DATABASE_URL
- CATALOG_SERVICE_URL

### Order Service
- DATABASE_URL
- CATALOG_SERVICE_URL
- INVENTORY_SERVICE_URL
- DEFAULT_BRANCH_CODE
- RABBITMQ_URL

### Notification Service
- DATABASE_URL
- RABBITMQ_URL

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
<br></br>

---

# Latihan 4 - SuiLens Microservices Workspace

Nama    : Georgina Elena Shinta Dewi Achti
NPM     : 2206810995

## 1. Pendahuluan

Pada tugas ini, saya mengimplementasikan observability pada sistem microservices SuiLens. Observability menjadi komponen penting karena sistem terdiri dari beberapa service yang saling berinteraksi, sehingga diperlukan mekanisme untuk memantau performa, mengumpulkan log secara terpusat, serta menelusuri alur request secara end-to-end.

Fokus implementasi mencakup tiga aspek utama, yaitu **monitoring**, **centralized logging**, dan **distributed tracing**. Ketiga aspek ini bertujuan untuk memberikan visibilitas yang menyeluruh terhadap kondisi sistem, baik dari sisi teknis maupun proses bisnis.

### Konteks Sistem

Sistem SuiLens merupakan aplikasi microservices yang terdiri dari:
- **Frontend** (Vue + Vuetify): dashboard untuk katalog, inventory, order, dan notifikasi realtime
- **Catalog Service**: layanan data lensa dan spesifikasi
- **Inventory Service**: manajemen stok per cabang dengan mekanisme reservasi
- **Order Service**: pembuatan dan pengelolaan order
- **Notification Service**: notifikasi real-time via WebSocket dan penyimpanan riwayat
- **Infrastruktur**: 4 PostgreSQL terpisah (per service) + RabbitMQ untuk event-driven communication

## Struktur Folder

```
.
├── frontend/suilens-frontend/          # Frontend Vue application
├── services/
│   ├── catalog-service/                # Catalog API service
│   ├── inventory-service/              # Inventory & reservation API
│   ├── order-service/                  # Order API + event publisher
│   └── notification-service/           # Notification API + WebSocket + event consumer
├── observability/
│   ├── prometheus/                     # Prometheus configuration
│   ├── grafana/                        # Grafana dashboards & provisioning
│   ├── filebeat/                       # Filebeat configuration
│   └── logstash/                       # Logstash pipeline rules
└── docker-compose.yml                  # Docker Compose orchestration
```

### 5) Frontend

Masuk ke frontend/suilens-frontend lalu jalankan:
- pnpm install
- pnpm dev

Port default: 5173

## 2. Gambaran Solusi dan Arsitektur

Dalam implementasi observability ini, saya menggunakan beberapa tools utama yang masing-masing berperan pada aspek observability yang berbeda:

- **Monitoring**: Prometheus sebagai pengumpul metrik dan Grafana sebagai dashboard visual
- **Centralized Logging**: ELK stack yang terdiri dari Filebeat, Logstash, Elasticsearch, dan Kibana
- **Distributed Tracing**: OpenTelemetry dengan Jaeger sebagai visualisasi trace

### Alur Data Observability

Setiap service menghasilkan data observability melalui mekanisme yang berbeda:

1. **Metrics Flow**: Service → `/metrics` endpoint → Prometheus (scrape setiap 15s) → Grafana Dashboard
   - Metrik yang dikumpulkan: request count, latency histogram, error rate, business metrics

2. **Logs Flow**: Service stdout → Filebeat (collect container logs) → Logstash (parse JSON) → Elasticsearch (index `suilens-logs-*`) → Kibana
   - Format: structured JSON dengan field timestamp, service_name, log_level, message, correlation_id, trace_id

3. **Traces Flow**: Service → OpenTelemetry SDK (instrument requests/calls/events) → OTLP exporter → Jaeger
   - Propagation: W3C traceparent + x-correlation-id header

### Infrastruktur Observability

Komponen tambahan dalam docker-compose.yml:
- Prometheus (port 9091): metric collection & storage
- Grafana (port 3005): dashboard visualization (login: admin/admin)
- Jaeger (port 16687): distributed tracing UI
- Elasticsearch (port 9201): centralized log storage
- Kibana (port 5602): log visualization & exploration
- Logstash: log processing & transformation
- Filebeat: container log collection

Konfigurasi observability tersimpan di:
- `observability/prometheus/prometheus.yml`: Prometheus config
- `observability/grafana/dashboards/suilens-observability.json`: Grafana dashboard
- `observability/filebeat/filebeat.yml`: Filebeat config
- `observability/logstash/pipeline/logstash.conf`: Logstash processing rules

## 3. Langkah Implementasi

### Monitoring

Pada bagian monitoring, saya menambahkan endpoint `/metrics` pada setiap service backend. Endpoint ini menyediakan metrik yang kemudian dikumpulkan oleh Prometheus. Metrik yang diimplementasikan meliputi:

1. **Jumlah Request** (`suilens_http_requests_total`)
   - Counter yang mencatat total request dengan label: service, method, route, status
   - Digunakan untuk melihat volume traffic pada sistem

2. **Latency Request** (`suilens_http_request_duration_seconds`)
   - Histogram yang mengukur durasi setiap request
   - Pada dashboard ditampilkan sebagai p95 untuk merepresentasikan performa mayoritas request
   - Peningkatan latency dapat mengindikasikan bottleneck pada service tertentu

3. **Error Rate**
   - Dihitung berdasarkan proporsi request dengan status 5xx terhadap total request
   - Memberikan indikasi adanya kegagalan di sisi backend

4. **Metrik Bisnis**
   - `suilens_orders_total`: jumlah order yang berhasil dan gagal
   - `suilens_inventory_reservations_total`: jumlah reservasi stok yang berhasil dan gagal
   - `suilens_notifications_total`: jumlah notifikasi yang diproses
   - Metrik ini memberikan gambaran aktivitas sistem dari sisi bisnis

Seluruh metrik tersebut divisualisasikan dalam dashboard Grafana (file: `observability/grafana/dashboards/suilens-observability.json`) sehingga kondisi sistem dapat dipantau secara real-time.

### Centralized Logging

Untuk centralized logging, saya menerapkan structured logging pada setiap service backend menggunakan format JSON. Setiap log memuat informasi penting seperti:

- `timestamp`: waktu kejadian event
- `service`: nama service yang mengeluarkan log
- `level`: log level (INFO, WARN, ERROR)
- `message`: pesan log yang informatif
- `endpoint`: URL endpoint yang diakses (jika ada)
- `correlation_id`: ID unik untuk menelusuri satu request lintas service
- `trace_id`: ID dari OpenTelemetry trace

Log yang dihasilkan oleh service dikirim ke stdout container, kemudian dikumpulkan oleh Filebeat. Selanjutnya, log diproses oleh Logstash (parsing JSON, transformasi field) sebelum disimpan di Elasticsearch dengan index pattern `suilens-logs-*`. Kibana digunakan untuk mengakses dan memvisualisasikan log tersebut dalam satu tempat.

Dengan pendekatan ini, log dari berbagai service dapat dianalisis secara terpusat tanpa harus membuka log container masing-masing secara terpisah. Correlation_id digunakan untuk menelusuri satu request yang sama di berbagai service sehingga mempermudah proses investigasi.

### Distributed Tracing

Pada bagian tracing, saya menggunakan OpenTelemetry untuk menginstrumentasi service backend. Tracing dilakukan pada beberapa poin penting:

1. **Inbound Request**: Setiap HTTP request yang masuk ke service diinstrumentasi sebagai root span

2. **Outbound HTTP Calls**: Setiap HTTP call dari satu service ke service lain (misalnya order → catalog, order → inventory) diinstrumentasi sebagai child span

3. **RabbitMQ Events**: Proses publish event ke RabbitMQ dan consume event dari RabbitMQ diinstrumentasi untuk melacak alur event-driven communication

4. **Context Propagation**: W3C trace context (`traceparent` header) dan `x-correlation-id` header dipropagasikan antar service untuk memastikan RequestID dan TraceID konsisten

Flow utama yang dianalisis adalah proses **create order** (`POST /api/orders`):
1. Request dimulai dari order-service sebagai entry point
2. Order-service memvalidasi lens ke catalog-service
3. Order-service melakukan reservasi ke inventory-service
4. Jika sukses, order-service mempublish event `order.placed` ke RabbitMQ
5. Notification-service mengonsumsi event dan memproses notifikasi

Trace yang dihasilkan dikirim ke Jaeger (OTLP eksporter), yang menampilkan hubungan antar span serta durasi setiap proses. Dengan visualisasi ini, alur request dapat dipahami secara menyeluruh dan bottleneck dalam sistem dapat diidentifikasi dengan lebih mudah.

## 4. Cara Menjalankan Sistem

Sistem dijalankan menggunakan Docker Compose dengan perintah berikut:

```bash
docker compose up --build
```

Setelah seluruh service berjalan (dapat dipantau dengan `docker compose ps`), masing-masing tools dapat diakses melalui URL berikut:

- **Grafana**: http://localhost:3005 (login: admin/admin)
- **Kibana**: http://localhost:5602
- **Jaeger**: http://localhost:16687
- **Prometheus**: http://localhost:9091
- **Frontend**: http://localhost:5173
- **Order Service API**: http://localhost:3002/api/orders

### Menghasilkan Data Observability

Untuk menghasilkan metrik, log, dan trace, dilakukan request ke endpoint create order dengan menyertakan header `x-correlation-id`. Request ini akan memicu munculnya metrics, log, dan trace sehingga dapat diamati pada masing-masing tools.

**Langkah 1: Ambil Lens ID**

```bash
curl -s http://localhost:3001/api/lenses | jq '.[] | .id' | head -n 1
```

**Langkah 2: Create Order dengan Correlation ID**

```bash
curl -X POST http://localhost:3002/api/orders \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: assignment-a04-001" \
  -d "{
    \"customerName\": \"A04 Test User\",
    \"customerEmail\": \"a04@test.local\",
    \"lensId\": \"<LENS_ID_FROM_STEP_1>\",
    \"branchCode\": \"KB-JKT-S\",
    \"startDate\": \"2026-04-01\",
    \"endDate\": \"2026-04-03\"
  }"
```

**Langkah 3: Generate Multiple Requests untuk Lebih Jelas**

Ulangi langkah 2 dengan correlation ID berbeda (assignment-a04-002, assignment-a04-003, dst) untuk membuat panel pada Grafana lebih jelas menampilkan metrics.

Oke, ini aku bikinin **FINAL VERSION yang udah dipoles**

* tetap formal
* tapi ada “jejak kamu ngerjain sendiri”
* ga terlalu textbook
* aman buat dikumpulin

Kamu tinggal replace bagian **5 & 6** ini aja di dokumen kamu 👇

---

## 5. Hasil Implementasi

### Monitoring

Hasil monitoring dapat diamati melalui dashboard Grafana yang menampilkan berbagai metrik utama sistem secara real-time. Berdasarkan pengujian yang dilakukan dengan beberapa request berturut-turut ke endpoint create order, terlihat bahwa grafik request rate mengalami peningkatan setelah load testing dijalankan. Hal ini menunjukkan bahwa sistem berhasil menerima dan memproses request sesuai dengan skenario pengujian.

Selain itu, latency p95 menunjukkan waktu respon mayoritas request yang relatif stabil selama pengujian berlangsung. Hal ini mengindikasikan bahwa performa sistem masih berada dalam kondisi yang baik. Metrik bisnis seperti jumlah order dan reservasi juga mengalami peningkatan seiring dengan bertambahnya request, yang menunjukkan bahwa proses bisnis utama berjalan dengan sukses.

Secara keseluruhan, dashboard Grafana memberikan gambaran kondisi sistem yang jelas dan dapat digunakan untuk memantau performa serta aktivitas sistem secara real-time.

---

### Centralized Logging

Pada bagian centralized logging, hasil implementasi dapat dilihat melalui Kibana yang menampilkan log dari berbagai service dalam satu tampilan terpusat. Berdasarkan hasil pengamatan, log dari beberapa service seperti order-service dan inventory-service berhasil muncul secara bersamaan dalam satu halaman Discover.

Log yang ditampilkan menggunakan format structured JSON, sehingga informasi seperti timestamp, service, level log, dan message dapat dianalisis dengan mudah. Dengan membuka detail log (expanded view), terlihat bahwa setiap log memuat informasi yang cukup untuk kebutuhan investigasi.

Selain itu, penggunaan correlation_id memungkinkan pelacakan satu request yang sama di berbagai service. Hal ini mempermudah proses debugging karena alur kejadian dapat ditelusuri secara lebih jelas tanpa harus membuka log dari masing-masing service secara terpisah.

---

### Distributed Tracing

Pada bagian distributed tracing, hasil implementasi dapat diamati melalui Jaeger yang menampilkan trace dari alur request dalam sistem. Berdasarkan trace yang ditampilkan, proses create order berhasil direkam dan divisualisasikan secara end-to-end.

Trace tersebut menunjukkan bahwa request dimulai dari order-service sebagai entry point, kemudian dilanjutkan ke catalog-service untuk validasi data, serta ke inventory-service untuk reservasi stok. Setelah itu, proses dilanjutkan melalui mekanisme event-driven yang diproses oleh notification-service.

Setiap tahapan direpresentasikan dalam bentuk span yang memiliki durasi eksekusi. Berdasarkan hasil pengamatan, terlihat bahwa beberapa proses seperti komunikasi ke inventory-service memiliki durasi yang relatif lebih tinggi dibandingkan proses lainnya. Hal ini menunjukkan bahwa bagian tersebut berpotensi menjadi bottleneck dan perlu diperhatikan lebih lanjut.

Dengan adanya visualisasi ini, hubungan antar service dapat dipahami dengan lebih jelas, serta mempermudah analisis performa sistem secara menyeluruh.

---

## 6. Penjelasan Metrik, Log, dan Flow Trace

Pada bagian monitoring, metrik yang ditampilkan pada dashboard Grafana menunjukkan aktivitas sistem secara real-time. Grafik request rate memperlihatkan jumlah request yang masuk ke sistem, di mana peningkatan nilai terjadi setelah dilakukan pengujian dengan beberapa request berturut-turut. Sementara itu, latency p95 digunakan untuk merepresentasikan waktu respon mayoritas request, sehingga dapat memberikan gambaran performa sistem secara umum. Selama pengujian, nilai latency cenderung stabil, yang menunjukkan bahwa sistem mampu menangani request dengan baik. Metrik bisnis seperti jumlah order dan reservasi juga meningkat, yang menandakan bahwa proses bisnis utama berjalan sesuai dengan yang diharapkan.

Pada bagian centralized logging, log yang ditampilkan pada Kibana menunjukkan data yang telah dikumpulkan dari berbagai service dalam satu tempat. Log disajikan dalam format structured JSON sehingga setiap informasi seperti timestamp, service, dan message dapat dibaca dengan jelas. Dengan adanya informasi ini, proses debugging menjadi lebih mudah karena dapat diketahui kapan suatu event terjadi dan pada service mana kejadian tersebut berlangsung. Selain itu, penggunaan correlation_id memungkinkan pelacakan satu request yang sama di berbagai service, sehingga alur kejadian dapat direkonstruksi dengan lebih mudah.

Pada bagian distributed tracing, visualisasi trace pada Jaeger menunjukkan alur request secara end-to-end. Proses dimulai dari order-service, kemudian dilanjutkan ke catalog-service untuk validasi, serta ke inventory-service untuk reservasi. Setelah itu, event diproses oleh notification-service melalui mekanisme asynchronous. Setiap proses direpresentasikan dalam bentuk span yang memiliki durasi eksekusi, sehingga dapat digunakan untuk mengidentifikasi bagian sistem yang membutuhkan waktu lebih lama. Berdasarkan hasil trace yang diamati, komunikasi antar service menjadi salah satu faktor yang mempengaruhi durasi total request. Dengan demikian, distributed tracing membantu dalam memahami alur sistem secara menyeluruh sekaligus mengidentifikasi potensi bottleneck.

