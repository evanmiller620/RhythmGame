-- ============================================================
-- RHYTHM — Supabase schema: shared maps and leaderboards
-- Run this in the Supabase SQL Editor (Dashboard → SQL).
--
-- Safe to run again: it creates what's missing and upgrades an
-- earlier install (the first version had only rhythm_maps)
-- without losing shared maps or scores.
--
-- This project shares a Supabase instance with Coup. Every object
-- here is prefixed `rhythm_`, and nothing below touches Coup's
-- tables (games, players, game_logs), its touch_updated_at()
-- function, or the realtime publication.
--
-- Model: players are anonymous (no Supabase Auth), like Coup.
--   * Anyone can browse and play maps, and read leaderboards.
--   * Anyone can share a map. Maps can't be edited after sharing.
--   * Only the browser that shared a map can delete it: it keeps a
--     random secret token in localStorage and sends only the token's
--     SHA-256 hash. Deleting means calling rhythm_delete_map() with
--     the original token. The hash is never readable via the API.
--   * The two built-in maps are rows marked featured = true, with
--     fixed ids the game knows. Nobody can delete them via the API.
--   * Scores are only written by rhythm_submit_score(), which checks
--     them against the map. Each player keeps their best score per
--     map. Players are identified by a random id their browser keeps;
--     the id is never returned by the API.
--   * You (the project owner) can delete anything from the
--     dashboard's Table Editor, which bypasses these rules.
--
-- Because players are anonymous, a determined cheater can still
-- submit a fabricated (but internally consistent) score. Remove such
-- rows from rhythm_scores in the dashboard.
-- ============================================================

-- ---------- Note validation ----------
-- notes is a JSON array of [lane, time_ms] pairs, e.g. [[0,1200],[3,1400]].
-- CASE is used so each check only runs once the previous one passed
-- (Postgres doesn't guarantee AND/OR short-circuiting).

create or replace function public.rhythm_notes_valid(n jsonb, expected_count int)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(n) <> 'array' then false
    when jsonb_array_length(n) <> expected_count then false
    else not exists (
      select 1
      from jsonb_array_elements(n) as e
      where not (
        case
          when jsonb_typeof(e) <> 'array' then false
          when jsonb_array_length(e) <> 2 then false
          when jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number' then false
          else (e->>0)::numeric in (0, 1, 2, 3)
           and (e->>1)::numeric between 0 and 1200000
        end
      )
    )
  end
$$;

-- ---------- Maps ----------

create table if not exists public.rhythm_maps (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 60),
  author       text not null check (char_length(btrim(author)) between 1 and 24),
  song         text not null check (song ~ '^[a-z0-9_-]{1,32}$'),   -- song id in the game, e.g. 'night'
  notes        jsonb not null,
  note_count   int  not null check (note_count between 1 and 5000),
  duration_ms  int  not null check (duration_ms between 0 and 1200000),
  plays        int  not null default 0 check (plays >= 0),
  owner_hash   text not null check (owner_hash ~ '^[0-9a-f]{64}$'), -- sha256(owner token), hex
  created_at   timestamptz not null default now(),
  constraint rhythm_maps_notes_valid check (public.rhythm_notes_valid(notes, note_count)),
  constraint rhythm_maps_notes_size  check (pg_column_size(notes) <= 262144)  -- 256 KB
);

-- Added in the leaderboard update: built-in maps are featured and listed first.
alter table public.rhythm_maps add column if not exists featured boolean not null default false;

-- List indexes. (The first version had indexes without `featured`; replace them.)
drop index if exists public.rhythm_maps_newest_idx;
drop index if exists public.rhythm_maps_popular_idx;
create index if not exists rhythm_maps_list_newest_idx  on public.rhythm_maps (featured desc, created_at desc);
create index if not exists rhythm_maps_list_popular_idx on public.rhythm_maps (featured desc, plays desc, created_at desc);

alter table public.rhythm_maps enable row level security;

drop policy if exists "rhythm maps are readable" on public.rhythm_maps;
create policy "rhythm maps are readable"
  on public.rhythm_maps for select to anon, authenticated
  using (true);

drop policy if exists "anyone may share a rhythm map" on public.rhythm_maps;
create policy "anyone may share a rhythm map"
  on public.rhythm_maps for insert to anon, authenticated
  with check (plays = 0 and featured = false);

-- No update or delete policies: rows can't be changed or removed
-- through the API except by the functions below.

-- Supabase grants every API role full access to new tables by
-- default. Narrow that: clients may read everything except
-- owner_hash, and may only set the listed columns when sharing.
revoke all on table public.rhythm_maps from anon, authenticated;
grant select (id, title, author, song, notes, note_count, duration_ms, plays, created_at, featured)
  on public.rhythm_maps to anon, authenticated;
grant insert (title, author, song, notes, note_count, duration_ms, owner_hash)
  on public.rhythm_maps to anon, authenticated;

-- ---------- Built-in maps ----------
-- The game's two Night maps, with the timing correction for the
-- original engine already applied. Re-running refreshes their notes
-- but keeps their play counts and leaderboards.

insert into public.rhythm_maps (id, title, author, song, notes, note_count, duration_ms, owner_hash, featured)
select v.id::uuid, v.title, v.author, v.song, v.notes, v.note_count, v.duration_ms,
       encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
       true
from (values
  ('1a576d70-7964-4e49-bd79-bcbacb393451', 'Night (Normal)', 'Rhythm', 'night', '[[0,4964],[0,5149],[0,5333],[0,5491],[3,5658],[3,5996],[0,6352],[0,6531],[0,6696],[0,6859],[3,7019],[3,7315],[0,7647],[1,7979],[2,8309],[3,8663],[0,8991],[1,9293],[2,9656],[3,9997],[0,10307],[0,10632],[3,10989],[3,11300],[1,11655],[1,11992],[2,12317],[2,12627],[0,12928],[3,12948],[2,13278],[1,13286],[3,13637],[0,13639],[1,13977],[2,13983],[3,14323],[3,14493],[0,14646],[0,14820],[3,14976],[3,15148],[0,15269],[0,15443],[1,15626],[2,15632],[0,15950],[3,15957],[2,16297],[1,16307],[0,16616],[3,16625],[1,16964],[1,17153],[3,17329],[3,17494],[1,17663],[1,17839],[3,17994],[3,18166],[0,18332],[2,18641],[1,18946],[3,19288],[3,19607],[0,19607],[2,19937],[1,19950],[0,20278],[3,20285],[1,20623],[2,20630],[0,20951],[2,20964],[3,21289],[1,21291],[0,21617],[2,21637],[3,21963],[1,21970],[0,22288],[1,22490],[2,22649],[3,22833],[0,22977],[1,23165],[2,23322],[3,23464],[0,23635],[0,23986],[3,24312],[3,24643],[1,24949],[1,25315],[0,25648],[2,25663],[1,25991],[3,25997],[0,26310],[0,26633],[3,26991],[3,27294],[2,27638],[2,27961],[0,28278],[3,28293],[2,28641],[1,28650],[0,28977],[0,29320],[2,29629],[2,29941],[1,30274],[1,30622],[0,30936],[3,30951],[1,31293],[2,31298],[0,31617],[1,31803],[2,31980],[3,32160],[0,32307],[1,32489],[2,32648],[3,32791],[3,33001],[3,33142],[1,33292],[1,33481],[3,33637],[3,33807],[1,33959],[1,34130],[2,34302],[1,34454],[2,34655],[0,34811],[0,34939],[3,35018],[1,35206],[2,35351],[1,35481],[2,35641],[0,35816],[2,35990],[1,36123],[2,36291],[0,36459],[2,36656],[1,36820],[2,37002],[0,37162],[2,37329],[1,37497],[2,37654],[0,37807],[2,37987],[1,38149],[2,38318],[0,38472],[2,38653],[1,38815],[3,38983],[0,39127],[2,39306],[1,39456],[2,39620],[0,39792],[2,39982],[1,40138],[2,40318],[0,40460],[2,40639],[1,40811],[2,40985],[0,41119],[2,41313],[1,41452],[3,41630],[0,41787],[2,41980],[1,42140],[3,42296],[2,42488],[1,42649],[0,42803],[3,42992],[2,43159],[1,43316],[0,43450],[0,43633],[1,43779],[2,43967],[3,44095],[3,44300],[2,44461],[1,44620],[0,44757],[0,44930],[0,45288],[0,45595],[0,45945],[3,46272],[3,46622],[3,46962],[3,47117],[3,47294],[3,47628],[3,47940],[3,48272],[3,48621],[0,48936],[1,49120],[2,49289],[3,49434],[0,49606],[2,49774],[1,49937],[3,50112],[0,50299],[2,50476],[1,50624],[3,50775],[0,50948],[2,51125],[1,51286],[3,51436],[0,51600],[0,51799],[0,51982],[0,52138],[3,52297],[3,52473],[3,52659],[3,52809],[1,52979],[2,53127],[0,53292],[3,53455],[1,53606],[2,53773],[0,53937],[3,54106],[0,54258],[1,54432],[2,54620],[3,54788],[0,54954],[1,55121],[2,55289],[3,55426],[0,55607],[0,55958],[0,56286],[0,56636],[2,56908],[0,56963],[3,57098],[0,57302],[2,57302],[3,57490],[0,57639],[2,57670],[3,57842],[0,57986],[2,57998],[3,58141],[0,58291],[2,58652],[1,58954],[3,59280],[1,59619],[3,59638],[0,59801],[3,59963],[1,59972],[0,60142],[3,60297],[1,60304],[0,60464],[3,60625],[1,60636],[0,60799],[0,60966],[2,61297],[1,61624],[3,61979],[1,62274],[2,62286],[0,62616],[3,62627],[1,62962],[2,62964],[3,63276],[0,63280],[0,63574],[1,63776],[2,63953],[3,64132],[0,64280],[1,64460],[2,64619],[3,64755],[3,64973],[2,65119],[1,65287],[0,65432],[0,65612],[2,65615],[1,65780],[3,65796],[2,65973],[3,66088],[2,66265],[0,66271],[3,66616],[1,66628],[2,66955],[0,66971],[3,67275],[1,67285],[2,67613],[0,67623],[3,67940],[1,67959],[2,68289],[0,68291],[1,68612],[3,68613],[0,68938],[2,68949],[3,69105],[0,69286],[2,69288],[3,69471],[1,69639],[2,69640],[3,69804],[0,69964],[2,69971],[3,70140],[2,70314],[3,70488],[1,70638],[2,70644],[3,70823],[0,70943],[2,70970],[3,71149],[1,71309],[2,71311],[3,71464],[0,71630],[2,71815],[1,71965],[3,72121],[0,72286],[2,72463],[1,72620],[3,72758],[0,72929],[2,72942],[3,73112],[1,73273],[2,73279],[3,73456],[2,73620],[0,73627],[3,73799],[1,73947],[2,73965],[3,74122],[0,74292],[2,74465],[1,74632],[3,74796],[0,74947],[2,75118],[1,75283],[3,75429],[0,75615],[2,75626],[3,75791],[1,75953],[2,75958],[3,76135],[2,76282],[0,76288],[3,76463],[2,76619],[1,76628],[3,76781],[0,76959],[2,77131],[1,77286],[3,77449],[0,77607],[2,77801],[1,77963],[3,78159],[1,78320],[2,78338],[3,78508],[0,78632],[2,78648],[3,78813],[1,78947],[2,78971],[3,79132],[2,79279],[0,79289],[3,79457],[1,79629],[2,79816],[0,79967],[3,80136],[1,80284],[2,80462],[0,80623],[3,80775],[1,80945],[3,80954],[2,81112],[0,81277],[3,81285],[2,81440],[1,81606],[3,81612],[2,81777],[0,81936],[3,81950],[2,82115],[1,82269],[2,82438],[0,82603],[3,82775],[1,82953],[0,83115],[0,83303],[0,83466],[2,83623],[1,83774],[3,83939],[0,84064],[2,84269],[1,84436],[1,84606],[1,84789],[2,84943],[0,85094],[3,85265],[1,85412],[2,85577],[2,85773],[2,85956],[2,86135],[3,86303],[0,86445],[2,86623],[1,86775],[3,86939],[0,87111],[2,87302],[1,87448],[3,87608],[0,87746],[2,87957],[1,88093],[3,88284],[0,88436],[2,88639],[1,88780],[0,88953],[1,89124],[2,89289],[3,89469],[0,89635],[1,89798],[2,89948],[3,90135],[0,90292],[2,90478],[1,90622],[3,90802],[0,90943],[2,91130],[1,91298],[3,91440],[3,91634],[2,91776],[1,91983],[0,92139],[3,92323],[2,92479],[1,92621],[0,92781],[0,92962],[1,93125],[2,93274],[3,93467],[1,93637],[2,93814],[1,93969],[2,94145],[1,94279],[3,94459],[0,94624],[2,94818],[1,94965],[3,95115],[0,95276],[2,95448],[0,95603],[0,95990],[3,96290],[3,96611],[2,96931],[1,96936],[3,97098],[1,97271],[2,97274],[3,97449],[2,97620],[1,97628],[1,97957],[1,98285]]'::jsonb, 527, 98285),
  ('cd3f9ca2-bd42-4150-a466-1625a3a4bd47', 'Night (Hard)', 'Rhythm', 'night', '[[0,4588],[1,4780],[2,4967],[3,5153],[0,5299],[1,5457],[2,5632],[3,5797],[0,5954],[0,6300],[0,6649],[0,6985],[3,7327],[2,7464],[1,7697],[0,7806],[3,7972],[2,8129],[1,8304],[0,8429],[3,8624],[3,8972],[3,9330],[3,9619],[0,9956],[1,10287],[2,10617],[3,10953],[1,11269],[2,11282],[3,11607],[0,11613],[1,11937],[2,11941],[0,12255],[3,12262],[0,12590],[0,12770],[3,12946],[1,13120],[2,13301],[0,13461],[3,13631],[1,13794],[0,13975],[0,14157],[3,14315],[1,14487],[2,14664],[0,14803],[3,14973],[1,15117],[0,15300],[0,15476],[3,15619],[1,15784],[2,15946],[0,16096],[3,16281],[1,16450],[0,16635],[0,16820],[3,16961],[1,17124],[2,17336],[0,17467],[3,17654],[1,17781],[0,17973],[0,18157],[0,18340],[0,18502],[3,18604],[3,18789],[3,18962],[3,19134],[3,19295],[2,19450],[1,19633],[0,19798],[3,19974],[2,20138],[1,20319],[0,20440],[0,20633],[1,20783],[2,20962],[3,21100],[3,21300],[2,21428],[1,21591],[0,21701],[0,21904],[1,22019],[2,22099],[3,22187],[3,22362],[2,22454],[1,22520],[0,22596],[0,22761],[1,22818],[2,22849],[3,22923],[3,23115],[0,23233],[0,23426],[0,23612],[0,23777],[2,23972],[2,24146],[2,24315],[2,24478],[1,24586],[1,24782],[1,24976],[1,25134],[3,25294],[3,25475],[3,25667],[3,25839],[3,25989],[2,26125],[1,26283],[0,26428],[0,26628],[1,26778],[2,26936],[3,27062],[0,27247],[1,27437],[2,27595],[0,27770],[3,27956],[1,28106],[2,28277],[0,28430],[3,28594],[1,28744],[2,28922],[0,29079],[3,29254],[1,29434],[2,29589],[0,29733],[3,29903],[1,30054],[1,30262],[1,30447],[3,30619],[0,30780],[2,30963],[1,31098],[3,31287],[0,31445],[2,31636],[2,31811],[1,31968],[3,32139],[0,32294],[2,32450],[1,32606],[3,32630],[2,32782],[0,32970],[3,32972],[2,33140],[1,33295],[3,33310],[2,33463],[0,33623],[3,33639],[2,33777],[1,33936],[0,34125],[3,34310],[1,34464],[2,34629],[0,34775],[3,34944],[1,35103],[2,35268],[0,35445],[2,35452],[3,35645],[1,35797],[2,35819],[3,35995],[0,36130],[2,36292],[1,36318],[3,36448],[0,36589],[2,36762],[1,36918],[3,37094],[0,37256],[2,37433],[1,37592],[3,37751],[0,37917],[3,37937],[2,38093],[0,38276],[3,38277],[2,38457],[3,38642],[0,38645],[2,38820],[0,38988],[3,38989],[2,39144],[1,39314],[2,39474],[0,39645],[3,39801],[1,39964],[2,40118],[0,40279],[3,40435],[1,40619],[2,40629],[3,40800],[1,40945],[2,40968],[3,41146],[2,41318],[1,41321],[3,41489],[2,41647],[1,41656],[3,41870],[0,42020],[2,42099],[1,42288],[3,42462],[0,42613],[2,42789],[1,42941],[3,43094],[0,43257],[2,43419],[1,43591],[3,43739],[0,43913],[1,44088],[2,44229],[3,44350],[1,44537],[0,44543],[2,44733],[0,44906],[1,44906],[2,45101],[0,45250],[1,45252],[2,45470],[1,45645],[0,45649],[3,45864],[2,45888],[1,46055],[3,46245],[2,46256],[1,46431],[3,46637],[2,46644],[1,46810],[3,46988],[2,46998],[1,47150],[0,47323],[2,47471],[0,47628],[2,47811],[0,47958],[2,48132],[0,48271],[2,48457],[1,48629],[2,48805],[1,48959],[2,49141],[1,49291],[2,49449],[1,49606],[2,49770],[3,49950],[2,49953],[1,50114],[3,50297],[2,50302],[1,50464],[3,50635],[2,50639],[1,50791],[3,50959],[2,50978],[1,51114],[2,51281],[3,51297],[1,51464],[3,51644],[2,51648],[1,51827],[3,51963],[2,51976],[1,52112],[3,52270],[2,52285],[1,52437],[3,52604],[2,52610],[1,52762],[0,52772],[3,52969],[2,52975],[1,53130],[0,53130],[3,53312],[2,53318],[1,53479],[0,53481],[3,53644],[2,53650],[1,53830],[0,53836],[2,53998],[0,54141],[1,54146],[2,54296],[1,54436],[0,54443],[2,54622],[0,54767],[1,54771],[2,54940],[0,55069],[1,55075],[3,55271],[2,55443],[1,55603],[0,55764],[1,55928],[2,56080],[3,56234],[2,56422],[1,56579],[2,56777],[1,56955],[2,57139],[1,57294],[2,57468],[1,57614],[2,57778],[0,57933],[1,58109],[2,58284],[3,58422],[1,58606],[2,58770],[0,58955],[1,59110],[2,59247],[1,59426],[2,59610],[1,59779],[2,59991],[1,60153],[2,60323],[1,60468],[3,60613],[0,60750],[3,60940],[0,61078],[2,61285],[1,61430],[2,61620],[1,61760],[3,61935],[0,62083],[3,62262],[0,62412],[3,62613],[2,62618],[1,62779],[3,62959],[2,62964],[1,63117],[3,63287],[1,63444],[3,63632],[1,63794],[3,63939],[1,63965],[0,64113],[3,64289],[1,64303],[0,64469],[0,64652],[2,64712],[1,64861],[2,65038],[1,65175],[2,65318],[1,65478],[2,65639],[1,65783],[2,65940],[2,66271],[2,66612],[2,66926],[2,67245],[1,67258],[1,67613],[2,67614],[2,67966],[1,67973],[1,68268],[2,68299],[2,68582],[0,68599],[3,68795],[0,68952],[2,68955],[3,69130],[2,69296],[0,69297],[3,69486],[0,69616],[2,69660],[3,69855],[1,70005],[2,70312],[1,70637],[2,70947],[1,71264],[3,71281],[0,71463],[3,71637],[1,71639],[0,71829],[3,71997],[1,72008],[0,72176],[1,72328],[3,72334],[0,72493],[2,72663],[1,72972],[3,73314],[1,73621],[3,73935],[1,73948],[2,74120],[1,74297],[3,74299],[2,74485],[3,74644],[1,74647],[2,74820],[1,74976],[3,74982],[2,75116],[1,75285],[2,75637],[1,75950],[2,76268],[0,76596],[2,76618],[1,76798],[2,76962],[0,76966],[1,77169],[0,77317],[2,77322],[1,77498],[0,77636],[2,77647],[1,77780],[3,77940],[1,78257],[2,78589],[0,78942],[3,79265],[1,79279],[2,79465],[0,79629],[3,79632],[2,79816],[1,79982],[3,79995],[2,80179],[0,80321],[3,80338],[2,80483],[1,80639],[3,80655],[2,80994],[0,81013],[3,81305],[1,81307],[2,81620],[0,81623],[3,81940],[1,81946],[2,82121],[0,82286],[3,82291],[2,82461],[1,82619],[3,82632],[2,82799],[3,82956],[0,82971],[2,83129],[1,83294],[2,83620],[0,83949],[3,84269],[0,84577],[3,84584],[2,84779],[1,84948],[3,84967],[2,85165],[0,85311],[3,85324],[2,85502],[1,85637],[3,85664],[2,85805],[0,85960],[3,85971],[1,86294],[2,86615],[0,86916],[3,87271],[1,87278],[2,87592],[0,87600],[1,87943],[3,87948],[0,88279],[2,88281],[3,88608],[1,88620],[2,88964],[1,89314],[2,89625],[0,89969],[3,89971],[2,90294],[1,90303],[3,90614],[0,90620],[2,90956],[1,90965],[0,91283],[3,91287],[3,91458],[0,91475],[2,91632],[1,91648],[2,91808],[1,91824],[3,91976],[0,91981],[3,92145],[0,92169],[2,92313],[1,92334],[2,92478],[1,92498],[3,92637],[1,92794],[3,92969],[1,93109],[2,93285],[0,93448],[2,93647],[0,93793],[3,93942],[0,94127],[3,94302],[0,94432],[2,94627],[1,94779],[2,94939],[1,95085],[0,95283],[1,95452],[2,95602],[3,95769],[3,95971],[2,96111],[1,96268],[0,96413],[3,96607],[3,96791],[0,96943],[0,97129],[3,97279],[0,97618],[0,97929],[0,98262],[0,98609],[0,98921],[0,99241]]'::jsonb, 609, 99241)
) as v(id, title, author, song, notes, note_count, duration_ms)
on conflict (id) do update
  set title = excluded.title, author = excluded.author, song = excluded.song,
      notes = excluded.notes, note_count = excluded.note_count,
      duration_ms = excluded.duration_ms, featured = true;

-- ---------- Scores ----------
-- One row per player per map: their best run.

create table if not exists public.rhythm_scores (
  map_id       uuid not null references public.rhythm_maps(id) on delete cascade,
  player_id    uuid not null,
  player_name  text not null check (char_length(btrim(player_name)) between 1 and 24),
  score        int  not null check (score >= 0),
  accuracy     numeric(5,2) not null check (accuracy between 0 and 100),
  grade        text not null check (grade in ('SS', 'S', 'A', 'B', 'C', 'D')),
  max_combo    int  not null check (max_combo >= 0),
  perfect      int  not null check (perfect >= 0),
  great        int  not null check (great >= 0),
  good         int  not null check (good >= 0),
  miss         int  not null check (miss >= 0),
  achieved_at  timestamptz not null default now(),
  primary key (map_id, player_id)
);

-- Ranking order: higher score first, then whoever got it first, then a fixed tie-breaker.
drop index if exists public.rhythm_scores_rank_idx;
create index if not exists rhythm_scores_order_idx on public.rhythm_scores (map_id, score desc, achieved_at, player_id);

-- RLS on with no policies, and no table privileges: the API can only
-- reach scores through the two functions below.
alter table public.rhythm_scores enable row level security;
revoke all on table public.rhythm_scores from anon, authenticated;

-- Record a finished run. Keeps the player's best and returns their
-- standing: {"rank", "total", "best", "improved"}.
create or replace function public.rhythm_submit_score(
  p_map_id uuid, p_player_id uuid, p_player_name text, p_score int, p_max_combo int,
  p_perfect int, p_great int, p_good int, p_miss int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  notes_total int;
  hits int;
  base int;
  ceiling numeric;
  acc numeric(5,2);
  grd text;
  best int;
  prev int;
  r int;
  n int;
begin
  select note_count into notes_total from public.rhythm_maps where id = p_map_id;
  if notes_total is null then
    raise exception 'unknown map' using errcode = '22023';
  end if;
  if p_player_id is null or p_player_name is null
     or char_length(btrim(p_player_name)) not between 1 and 24 then
    raise exception 'invalid player' using errcode = '22023';
  end if;
  if least(p_score, p_max_combo, p_perfect, p_great, p_good, p_miss) < 0 then
    raise exception 'values can''t be negative' using errcode = '22023';
  end if;
  if p_perfect + p_great + p_good + p_miss <> notes_total then
    raise exception 'judgments must add up to the map''s notes' using errcode = '22023';
  end if;

  hits := p_perfect + p_great + p_good;
  if p_max_combo > hits then
    raise exception 'combo is longer than the hits' using errcode = '22023';
  end if;

  -- The game scores 300/200/100 per hit times a combo multiplier that
  -- ramps from 1x to 2x over the first 100 combo. So a run's score lies
  -- between its base points and twice that, and can never exceed an
  -- all-Perfect full combo of the same length. Scores are whole
  -- numbers (300, 200 and 100 times k/100 always are), so no slack.
  base := 300 * p_perfect + 200 * p_great + 100 * p_good;
  ceiling := case when hits <= 100 then 300 * (hits + hits * (hits + 1) / 200.0)
                  else 300 * (2 * hits - 49.5) end;
  if p_score < base or p_score > least(2 * base, ceiling) then
    raise exception 'score doesn''t match the judgments' using errcode = '22023';
  end if;

  acc := round(base * 100.0 / (300 * notes_total), 2);
  grd := case when p_perfect = notes_total then 'SS'
              when acc >= 95 then 'S' when acc >= 90 then 'A'
              when acc >= 80 then 'B' when acc >= 70 then 'C' else 'D' end;

  select score into prev from public.rhythm_scores where map_id = p_map_id and player_id = p_player_id;

  insert into public.rhythm_scores as s
    (map_id, player_id, player_name, score, accuracy, grade, max_combo, perfect, great, good, miss)
  values
    (p_map_id, p_player_id, btrim(p_player_name), p_score, acc, grd, p_max_combo, p_perfect, p_great, p_good, p_miss)
  on conflict (map_id, player_id) do update
    set player_name = excluded.player_name,
        score       = case when excluded.score > s.score then excluded.score       else s.score end,
        accuracy    = case when excluded.score > s.score then excluded.accuracy    else s.accuracy end,
        grade       = case when excluded.score > s.score then excluded.grade       else s.grade end,
        max_combo   = case when excluded.score > s.score then excluded.max_combo   else s.max_combo end,
        perfect     = case when excluded.score > s.score then excluded.perfect     else s.perfect end,
        great       = case when excluded.score > s.score then excluded.great       else s.great end,
        good        = case when excluded.score > s.score then excluded.good        else s.good end,
        miss        = case when excluded.score > s.score then excluded.miss        else s.miss end,
        achieved_at = case when excluded.score > s.score then now()                else s.achieved_at end
  returning s.score into best;

  -- Rank = 1 + players ahead in leaderboard order (score desc, achieved_at asc,
  -- player_id asc). The row comparison below reads: o is ahead of me.
  select count(*) + 1 into r
    from public.rhythm_scores o, public.rhythm_scores me
   where me.map_id = p_map_id and me.player_id = p_player_id
     and o.map_id = p_map_id
     and (o.score, me.achieved_at, me.player_id) > (me.score, o.achieved_at, o.player_id);
  select count(*) into n from public.rhythm_scores where map_id = p_map_id;

  return json_build_object('rank', r, 'total', n, 'best', best,
                           'improved', prev is null or p_score > prev);
end $$;

-- Top scores for a map, plus the asking player's own row if it's
-- outside the top. `mine` marks the asking player's row.
create or replace function public.rhythm_leaderboard(p_map_id uuid, p_player_id uuid default null, p_limit int default 10)
returns table (rank bigint, player_name text, score int, accuracy numeric, grade text,
               max_combo int, achieved_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select s.*, row_number() over (order by s.score desc, s.achieved_at asc, s.player_id asc) as rn
      from public.rhythm_scores s
     where s.map_id = p_map_id
  )
  select rn, player_name, score, accuracy, grade, max_combo, achieved_at,
         coalesce(player_id = p_player_id, false)
    from ranked
   where rn <= greatest(1, least(coalesce(p_limit, 10), 50))
      or player_id = p_player_id
   order by rn;
$$;

-- ---------- Map functions ----------

-- Delete a map you shared. Returns true if a map was deleted.
create or replace function public.rhythm_delete_map(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int;
begin
  if p_token is null or char_length(p_token) < 32 then
    return false;
  end if;
  delete from public.rhythm_maps
   where id = p_id
     and featured = false
     and owner_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  get diagnostics deleted = row_count;
  return deleted > 0;
end $$;

-- Count one finished play of a map.
create or replace function public.rhythm_count_play(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rhythm_maps set plays = plays + 1 where id = p_id;
$$;

-- ---------- Function privileges ----------

revoke all on function public.rhythm_delete_map(uuid, text) from public;
revoke all on function public.rhythm_count_play(uuid) from public;
revoke all on function public.rhythm_notes_valid(jsonb, int) from public;
revoke all on function public.rhythm_submit_score(uuid, uuid, text, int, int, int, int, int, int) from public;
revoke all on function public.rhythm_leaderboard(uuid, uuid, int) from public;
grant execute on function public.rhythm_delete_map(uuid, text) to anon, authenticated;
grant execute on function public.rhythm_count_play(uuid) to anon, authenticated;
grant execute on function public.rhythm_submit_score(uuid, uuid, text, int, int, int, int, int, int) to anon, authenticated;
grant execute on function public.rhythm_leaderboard(uuid, uuid, int) to anon, authenticated;
-- The check constraint calls rhythm_notes_valid with the rights of
-- whoever is inserting, so the API roles need to be able to run it.
-- It only inspects the JSON it is given.
grant execute on function public.rhythm_notes_valid(jsonb, int) to anon, authenticated;

-- ---------- Undo ----------
-- To remove everything this file created:
--   drop table if exists public.rhythm_scores;
--   drop table if exists public.rhythm_maps;
--   drop function if exists public.rhythm_submit_score(uuid, uuid, text, int, int, int, int, int, int);
--   drop function if exists public.rhythm_leaderboard(uuid, uuid, int);
--   drop function if exists public.rhythm_delete_map(uuid, text);
--   drop function if exists public.rhythm_count_play(uuid);
--   drop function if exists public.rhythm_notes_valid(jsonb, int);
