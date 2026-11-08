-- Procurement department: source of truth for suppliers, threads, quotes, approvals.
create table if not exists suppliers (
  id serial primary key,
  name text not null,
  source text,              -- alibaba | 1688 | made-in-china | manual
  source_url text,
  country text,
  years int,
  verified boolean,
  trade_assurance boolean,
  response_rate text,
  products jsonb,
  score numeric,
  stage text not null default 'found', -- found|contacted|replied|negotiating|recommended|approved|ordered|rejected
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists supplier_contacts (
  id serial primary key,
  supplier_id int references suppliers(id) on delete cascade,
  channel text not null,    -- alibaba | email | wechat | whatsapp | phone
  handle text not null,     -- contactSupplierUrl | email address | WeChat remark "S012 Shenzhen-XYZ" | +86...
  label text,
  unique (channel, handle)
);

create table if not exists conversations (
  id serial primary key,
  supplier_id int references suppliers(id) on delete cascade,
  channel text not null,
  external_thread_id text,  -- AgentMail thread_id | WeChat remark | Alibaba thread title
  naive_session_id text,
  state text not null default 'open',  -- open|waiting_supplier|waiting_founder|closed
  next_followup_at timestamptz,
  created_at timestamptz default now(),
  unique (channel, external_thread_id)
);

create table if not exists messages (
  id serial primary key,
  conversation_id int references conversations(id) on delete cascade,
  direction text not null,  -- in | out
  external_id text unique,  -- provider id or hash(remark+ts+text); dedupes at-least-once deliveries
  body_original text,
  body_en text,
  attachments jsonb,
  screenshot_url text,
  sent_by text,             -- agent | human | supplier
  ts timestamptz default now()
);
create index if not exists messages_conv_ts on messages(conversation_id, ts);

create table if not exists quotes (
  id serial primary key,
  supplier_id int references suppliers(id) on delete cascade,
  message_id int references messages(id),
  unit_price numeric,
  currency text,
  moq int,
  lead_time_days int,
  certs text[],
  sample_cost numeric,
  sample_lead_days int,
  payment_terms text,
  incoterm text,
  confidence text,
  needs_review boolean default false,
  raw jsonb,
  created_at timestamptz default now()
);

create table if not exists authority_limits (
  key text primary key,
  value jsonb not null
);
insert into authority_limits(key, value) values
  ('max_unit_price_usd', '18'),
  ('max_moq', '1000'),
  ('max_sample_spend_usd', '300'),
  ('allowed_incoterms', '["FOB","EXW","DDP","DAP"]'),
  ('allowed_payment_terms', '["30/70 T/T","Trade Assurance","PayPal for samples"]'),
  ('target_qty', '500'),
  ('never', '["deposit","wire to personal account","full prepayment"]')
on conflict (key) do nothing;

create table if not exists decision_memos (
  id serial primary key,
  naive_session_id text,
  markdown text,
  ranked jsonb,
  created_at timestamptz default now()
);

create table if not exists approvals (
  id serial primary key,
  memo_id int references decision_memos(id),
  naive_session_id text not null,
  tool_call_id text,
  question jsonb,
  decision text,            -- proceed | counter | reject
  note text,
  decided_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists audit_events (
  id serial primary key,
  kind text not null,
  payload jsonb,
  ts timestamptz default now()
);

create table if not exists device_jobs (
  id serial primary key,
  device_id text not null,
  kind text not null,       -- wechat_send | wechat_read | alibaba_send | alibaba_read | wechat_add
  payload jsonb,
  status text not null default 'queued',  -- queued|running|done|failed
  mobilerun_task_id text,
  result jsonb,
  error text,
  created_at timestamptz default now(),
  finished_at timestamptz
);
create index if not exists device_jobs_status on device_jobs(device_id, status, id);
