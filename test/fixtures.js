/** Échantillons de flux réels, réduits, pour les tests hors ligne. */

export const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Jüdische Allgemeine</title>
  <link>https://www.juedische-allgemeine.de</link>
  <description>Wochenzeitung</description>
  <language>de</language>
  <item>
    <title><![CDATA[Antisemitismus an Berliner Schulen nimmt zu]]></title>
    <link>https://www.juedische-allgemeine.de/politik/antisemitismus-schulen?utm_source=rss&amp;utm_medium=feed</link>
    <guid isPermaLink="false">ja-40912</guid>
    <pubDate>Wed, 22 Jul 2026 09:14:00 +0200</pubDate>
    <dc:creator>Miriam Berger</dc:creator>
    <description><![CDATA[<p>Die Zahl der gemeldeten Vorf&auml;lle steigt deutlich.</p>]]></description>
    <content:encoded><![CDATA[<p>Die Zahl der gemeldeten Vorfälle steigt deutlich, so der Bericht.</p><img src="https://img.example/a.jpg">]]></content:encoded>
    <category>Politik</category>
    <category>Antisemitismus</category>
    <media:content url="https://img.example/gross.jpg" medium="image" />
  </item>
  <item>
    <title>Neues Buch über die Wiener Gemeinde erscheint im Herbst</title>
    <link>https://www.juedische-allgemeine.de/kultur/neues-buch-wien</link>
    <pubDate>Mon, 20 Jul 2026 11:00:00 +0200</pubDate>
    <description>Der Verlag kündigt eine Biografie an.</description>
  </item>
</channel>
</rss>`;

export const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Szombat</title>
  <link rel="self" href="https://www.szombat.org/feed"/>
  <link rel="alternate" href="https://www.szombat.org"/>
  <subtitle>Zsidó politikai és kulturális folyóirat</subtitle>
  <entry>
    <title>Zsinagógát avattak Debrecenben</title>
    <link rel="alternate" href="https://www.szombat.org/hirek/zsinagoga-debrecen"/>
    <id>tag:szombat.org,2026:1234</id>
    <published>2026-07-23T07:30:00Z</published>
    <updated>2026-07-23T08:00:00Z</updated>
    <author><name>Kovács Anna</name></author>
    <summary type="html">&lt;p&gt;A felújított épületet ünnepélyes keretek között adták át.&lt;/p&gt;</summary>
  </entry>
</feed>`;

export const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.org">
    <title>Vieux flux RDF</title>
    <link>https://example.org</link>
    <description>Test</description>
  </channel>
  <item rdf:about="https://example.org/a">
    <title>La communauté juive de Thessalonique commémore</title>
    <link>https://example.org/a</link>
    <dc:date>2026-07-21T10:00:00+03:00</dc:date>
    <description>Cérémonie annuelle.</description>
  </item>
</rdf:RDF>`;

export const GOOGLE_NEWS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>"żydowski" - Google News</title>
  <item>
    <title>Nowa wystawa o Żydach w Krakowie - Gazeta Krakowska</title>
    <link>https://news.google.com/rss/articles/CBMiK2h0dHBz?oc=5</link>
    <guid isPermaLink="false">CBMiK2h0dHBz</guid>
    <pubDate>Thu, 23 Jul 2026 06:12:00 GMT</pubDate>
    <description>&lt;a href="https://news.google.com/rss/articles/CBMiK2h0dHBz?oc=5"&gt;Nowa wystawa o Żydach w Krakowie&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Gazeta Krakowska&lt;/font&gt;</description>
    <source url="https://gazetakrakowska.pl">Gazeta Krakowska</source>
  </item>
  <item>
    <title>Synagoga w Warszawie zdewastowana - TVN24</title>
    <link>https://news.google.com/rss/articles/AAAA?oc=5</link>
    <pubDate>Wed, 22 Jul 2026 18:00:00 GMT</pubDate>
    <source url="https://tvn24.pl">TVN24</source>
  </item>
</channel>
</rss>`;

export const PODCAST = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Unorthodox</title>
  <item>
    <title>Episode 412: The Yiddish Revival</title>
    <link>https://tabletmag.com/unorthodox/412</link>
    <pubDate>Thu, 23 Jul 2026 12:00:00 GMT</pubDate>
    <description>A conversation about Yiddish today.</description>
    <enclosure url="https://cdn.example/412.mp3" length="48210000" type="audio/mpeg"/>
  </item>
</channel>
</rss>`;

export const CASSE = '<html><body><h1>404 Not Found</h1></body></html>';
