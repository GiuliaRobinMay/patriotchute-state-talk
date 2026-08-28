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

/* Members outside the States get a room of their own, listed under the
   states as "Other countries". They work exactly like a state room: their
   country ↔ All USA in the switcher, same chat, same Live Room.

   `a` is the room's two-letter code — the database allows exactly two
   characters, and it is never shown to anyone once a country carries a
   flag. Canada cannot be CA: that is California. CN is Canada's code HERE
   and nowhere else; do not read it as a country standard.

   `f` is the flag shown instead of the code, and `sw` the short label for
   the room switcher, where a long name would crowd a phone. */
window.COUNTRIES = [
  {n:"United Kingdom",a:"UK",f:"🇬🇧",sw:"🇬🇧 UK",seed:0},
  {n:"Canada",        a:"CN",f:"🇨🇦",sw:"🇨🇦 Canada",seed:0}
];

/* Rooms shown as "live" in the preview. Replaced by real voice presence later. */
window.LIVE_SEED = ["OH","TX","FL","PA","MI","NC","GA","AZ"];

/* A few real cities per state, used as the placeholder in the join form. */
window.CITIES = {
  AL:["Birmingham","Huntsville","Mobile"], AK:["Anchorage","Fairbanks","Juneau"],
  AZ:["Phoenix","Tucson","Mesa"], AR:["Little Rock","Fayetteville","Fort Smith"],
  CA:["Los Angeles","San Diego","Sacramento"], CO:["Denver","Colorado Springs","Boulder"],
  CT:["Hartford","New Haven","Stamford"], DE:["Wilmington","Dover","Newark"],
  FL:["Miami","Orlando","Tampa"], GA:["Atlanta","Savannah","Augusta"],
  HI:["Honolulu","Hilo","Kailua"], ID:["Boise","Idaho Falls","Nampa"],
  IL:["Chicago","Springfield","Peoria"], IN:["Indianapolis","Fort Wayne","Bloomington"],
  IA:["Des Moines","Cedar Rapids","Davenport"], KS:["Wichita","Topeka","Overland Park"],
  KY:["Louisville","Lexington","Bowling Green"], LA:["New Orleans","Baton Rouge","Shreveport"],
  ME:["Portland","Bangor","Augusta"], MD:["Baltimore","Annapolis","Frederick"],
  MA:["Boston","Worcester","Springfield"], MI:["Detroit","Grand Rapids","Ann Arbor"],
  MN:["Minneapolis","Saint Paul","Duluth"], MS:["Jackson","Gulfport","Hattiesburg"],
  MO:["Kansas City","St. Louis","Springfield"], MT:["Billings","Missoula","Bozeman"],
  NE:["Omaha","Lincoln","Grand Island"], NV:["Las Vegas","Reno","Henderson"],
  NH:["Manchester","Nashua","Concord"], NJ:["Newark","Jersey City","Princeton"],
  NM:["Albuquerque","Santa Fe","Las Cruces"], NY:["Buffalo","Rochester","Albany"],
  NC:["Charlotte","Raleigh","Asheville"], ND:["Fargo","Bismarck","Grand Forks"],
  OH:["Columbus","Cleveland","Dayton"], OK:["Oklahoma City","Tulsa","Norman"],
  OR:["Portland","Eugene","Bend"], PA:["Philadelphia","Pittsburgh","Harrisburg"],
  RI:["Providence","Newport","Warwick"], SC:["Charleston","Columbia","Greenville"],
  SD:["Sioux Falls","Rapid City","Pierre"], TN:["Nashville","Memphis","Knoxville"],
  TX:["Houston","Austin","Dallas"], UT:["Salt Lake City","Provo","Ogden"],
  VT:["Burlington","Montpelier","Rutland"], VA:["Richmond","Norfolk","Roanoke"],
  WA:["Seattle","Spokane","Tacoma"], WV:["Charleston","Huntington","Morgantown"],
  WI:["Milwaukee","Madison","Green Bay"], WY:["Cheyenne","Casper","Laramie"],
  DC:["Washington","Georgetown","Anacostia"],
  UK:["London","Manchester","Birmingham"], CN:["Toronto","Vancouver","Calgary"]
};

/* Avatar colours, paired so text stays legible on each. */
window.AV_COLORS = [
  {bg:"#BF3B2E",fg:"#FBF8F2"},{bg:"#2E8B7C",fg:"#03150F"},{bg:"#4A6FA5",fg:"#F4F1EA"},
  {bg:"#8E6BA8",fg:"#F4F1EA"},{bg:"#B5763F",fg:"#0D1729"},{bg:"#7186AB",fg:"#0D1729"},
  {bg:"#C06A5A",fg:"#0D1729"},{bg:"#3FA08F",fg:"#03150F"}
];
