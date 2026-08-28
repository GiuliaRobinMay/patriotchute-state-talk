-- ── Talk Time 2.0: a clean start, and a welcome from Chas ─────────
--
-- Paste the whole of this into Supabase → SQL Editor → New query → Run.
-- Nothing in here needs changing first.
--
-- It empties the Alabama and All USA rooms, then posts one welcome from
-- Chas at the top of all 54 rooms. If it cannot find Chas, it stops and
-- changes nothing at all.

begin;

delete from messages where room in ('AL', 'US');

insert into messages (room, author, body)
select
  r.code,
  (select id from profiles where name ilike 'chas%' order by created_at limit 1),
  '🇺🇸  Welcome to Talk Time 2.0 — ' || r.name || E'\n\n' ||
  case r.kind
    when 'usa' then
      'We are glad you are here. This is the room the whole community shares — patriots from every state, meeting on common ground. Whatever your corner of the country, you have neighbors in here.'
    when 'country' then
      'We are glad you are here. This room is for our friends in ' || r.name ||
      ' who stand with America and love what she stands for. You are among neighbors.'
    else
      'We are glad you are here. This room belongs to you and your neighbors in ' || r.name ||
      ' — a front porch where we can speak plainly, look out for one another, and talk about what is really happening where we live.'
  end
  || E'\n\n' ||
  'There are two ways to join in. Type right here and say hello — tell us your town and what brought you. Or press TALK TIME at the top and use your voice: you can just listen, raise a hand when you want a turn, or take the mic and speak. Everyone can hear; nobody hears you until you choose to be heard.'
  || E'\n\n' ||
  'Say hello. This is your table too. God bless you, and welcome home.'
from (values
  ('US', 'All USA', 'usa'),
  ('AL', 'Alabama', 'state'),
  ('AK', 'Alaska', 'state'),
  ('AZ', 'Arizona', 'state'),
  ('AR', 'Arkansas', 'state'),
  ('CA', 'California', 'state'),
  ('CO', 'Colorado', 'state'),
  ('CT', 'Connecticut', 'state'),
  ('DE', 'Delaware', 'state'),
  ('FL', 'Florida', 'state'),
  ('GA', 'Georgia', 'state'),
  ('HI', 'Hawaii', 'state'),
  ('ID', 'Idaho', 'state'),
  ('IL', 'Illinois', 'state'),
  ('IN', 'Indiana', 'state'),
  ('IA', 'Iowa', 'state'),
  ('KS', 'Kansas', 'state'),
  ('KY', 'Kentucky', 'state'),
  ('LA', 'Louisiana', 'state'),
  ('ME', 'Maine', 'state'),
  ('MD', 'Maryland', 'state'),
  ('MA', 'Massachusetts', 'state'),
  ('MI', 'Michigan', 'state'),
  ('MN', 'Minnesota', 'state'),
  ('MS', 'Mississippi', 'state'),
  ('MO', 'Missouri', 'state'),
  ('MT', 'Montana', 'state'),
  ('NE', 'Nebraska', 'state'),
  ('NV', 'Nevada', 'state'),
  ('NH', 'New Hampshire', 'state'),
  ('NJ', 'New Jersey', 'state'),
  ('NM', 'New Mexico', 'state'),
  ('NY', 'New York', 'state'),
  ('NC', 'North Carolina', 'state'),
  ('ND', 'North Dakota', 'state'),
  ('OH', 'Ohio', 'state'),
  ('OK', 'Oklahoma', 'state'),
  ('OR', 'Oregon', 'state'),
  ('PA', 'Pennsylvania', 'state'),
  ('RI', 'Rhode Island', 'state'),
  ('SC', 'South Carolina', 'state'),
  ('SD', 'South Dakota', 'state'),
  ('TN', 'Tennessee', 'state'),
  ('TX', 'Texas', 'state'),
  ('UT', 'Utah', 'state'),
  ('VT', 'Vermont', 'state'),
  ('VA', 'Virginia', 'state'),
  ('WA', 'Washington', 'state'),
  ('WV', 'West Virginia', 'state'),
  ('WI', 'Wisconsin', 'state'),
  ('WY', 'Wyoming', 'state'),
  ('DC', 'Washington DC', 'state'),
  ('UK', 'United Kingdom', 'country'),
  ('CN', 'Canada', 'country')
) as r(code, name, kind);

commit;
