/* The 50 states plus DC. `seed` is a placeholder headcount used until the
   database is wired up — it makes empty rooms look plausible in the preview
   and is ignored the moment real presence data exists. */
window.STATES = [
  {n:"Alabama",a:"AL",seed:71},{n:"Alaska",a:"AK",seed:12},{n:"Arizona",a:"AZ",seed:188},
  {n:"Arkansas",a:"AR",seed:44},{n:"California",a:"CA",seed:406},{n:"Colorado",a:"CO",seed:121},
  {n:"Connecticut",a:"CT",seed:58},{n:"Delaware",a:"DE",seed:17},{n:"Florida",a:"FL",seed:377},
  {n:"Georgia",a:"GA",seed:204},{n:"Hawaii",a:"HI",seed:19},{n:"Idaho",a:"ID",seed:49},
  {n:"Illinois",a:"IL",seed:212},{n:"Indiana",a:"IN",seed:134},{n:"Iowa",a:"IA",seed:63},
  {n:"Kansas",a:"KS",seed:55},{n:"Kentucky",a:"KY",seed:88},{n:"Louisiana",a:"LA",seed:79},
  {n:"Maine",a:"ME",seed:31},{n:"Maryland",a:"MD",seed:96},{n:"Massachusetts",a:"MA",seed:111},
  {n:"Michigan",a:"MI",seed:197},{n:"Minnesota",a:"MN",seed:108},{n:"Mississippi",a:"MS",seed:41},
  {n:"Missouri",a:"MO",seed:127},{n:"Montana",a:"MT",seed:22},{n:"Nebraska",a:"NE",seed:36},
  {n:"Nevada",a:"NV",seed:67},{n:"New Hampshire",a:"NH",seed:28},{n:"New Jersey",a:"NJ",seed:142},
  {n:"New Mexico",a:"NM",seed:39},{n:"New York",a:"NY",seed:318},{n:"North Carolina",a:"NC",seed:219},
  {n:"North Dakota",a:"ND",seed:9},{n:"Ohio",a:"OH",seed:214},{n:"Oklahoma",a:"OK",seed:72},
  {n:"Oregon",a:"OR",seed:84},{n:"Pennsylvania",a:"PA",seed:241},{n:"Rhode Island",a:"RI",seed:14},
  {n:"South Carolina",a:"SC",seed:103},{n:"South Dakota",a:"SD",seed:11},{n:"Tennessee",a:"TN",seed:156},
  {n:"Texas",a:"TX",seed:392},{n:"Utah",a:"UT",seed:61},{n:"Vermont",a:"VT",seed:8},
  {n:"Virginia",a:"VA",seed:148},{n:"Washington",a:"WA",seed:132},{n:"West Virginia",a:"WV",seed:33},
  {n:"Wisconsin",a:"WI",seed:99},{n:"Wyoming",a:"WY",seed:7},{n:"Washington DC",a:"DC",seed:47}
];

/* Rooms shown as "live" in the preview. Replaced by real voice presence later. */
window.LIVE_SEED = ["OH","TX","FL","PA","MI","NC","GA","AZ"];

/* Example members, shown until the database is connected so the roster design
   can be judged. Every one of these disappears the moment real people exist. */
window.SAMPLE_PEOPLE = [
  {name:"Bee Ann",     city:"Akron",      online:true},
  {name:"Tom Hargrove",city:"Dayton",     online:true},
  {name:"Kris N.",     city:"Toledo",     online:true},
  {name:"Marcus P.",   city:"Dayton",     online:false},
  {name:"Joan L.",     city:"Columbus",   online:false},
  {name:"Sam K.",      city:"Cincinnati", online:false},
  {name:"Pat Whitfield",city:"Cleveland", online:false},
  {name:"Elena G.",    city:"Akron",      online:false}
];

/* Avatar colours, paired so text stays legible on each. */
window.AV_COLORS = [
  {bg:"#BF3B2E",fg:"#FBF8F2"},{bg:"#2E8B7C",fg:"#03150F"},{bg:"#4A6FA5",fg:"#F4F1EA"},
  {bg:"#8E6BA8",fg:"#F4F1EA"},{bg:"#B5763F",fg:"#0D1729"},{bg:"#7186AB",fg:"#0D1729"},
  {bg:"#C06A5A",fg:"#0D1729"},{bg:"#3FA08F",fg:"#03150F"}
];
