import { load } from 'cheerio';
import Base64 from 'crypto-js/enc-base64';
import Utf8 from 'crypto-js/enc-utf8';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { smashyStreamOScraper } from '@/providers/embeds/smashystream/opstream';
import { smashyStreamFScraper } from '@/providers/embeds/smashystream/video1';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';

async function fetchCaptchaToken(ctx: MovieScrapeContext | ShowScrapeContext, domain: string, recaptchaKey: string) {
  // from streamsb scraper
  // by mrjvs
  const domainHash = Base64.stringify(Utf8.parse(domain)).replace(/=/g, '.');

  const recaptchaRender = await ctx.proxiedFetcher<string>(`https://www.google.com/recaptcha/api.js`, {
    query: {
      render: recaptchaKey,
    },
  });

  const vToken = recaptchaRender.substring(
    recaptchaRender.indexOf('/releases/') + 10,
    recaptchaRender.indexOf('/recaptcha__en.js'),
  );

  const recaptchaAnchor = await ctx.proxiedFetcher<string>(
    `https://www.google.com/recaptcha/api2/anchor?cb=1&hl=en&size=invisible&cb=flicklax`,
    {
      query: {
        k: recaptchaKey,
        co: domainHash,
        v: vToken,
      },
    },
  );

  const cToken = load(recaptchaAnchor)('#recaptcha-token').attr('value');
  if (!cToken) throw new Error('Unable to find cToken');

  const tokenData = await ctx.proxiedFetcher<string>(`https://www.google.com/recaptcha/api2/reload`, {
    query: {
      v: vToken,
      reason: 'q',
      k: recaptchaKey,
      c: cToken,
      sa: '',
      co: domain,
    },
    headers: { referer: 'https://www.google.com/recaptcha/api2/' },
    method: 'POST',
  });

  const token = tokenData.match('rresp","(.+?)"');
  return token ? token[1] : null;
}

const baseUrl = 'https://embed.smashystream.com';

const universalScraper = async (ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> => {
  const captchaPage = load(await ctx.proxiedFetcher('/videocaptcha.php', { baseUrl }));
  const siteKey = captchaPage('.g-recaptcha').attr('data-sitekey');
  if (!siteKey) throw new Error('Failed to get site key');

  const token = await fetchCaptchaToken(ctx, baseUrl, siteKey);
  if (!token) throw new Error('Failed to bypass recaptcha');

  // this whitelists the ip
  await ctx.proxiedFetcher('/getplayer.php', {
    baseUrl,
    method: 'POST',
    body: new URLSearchParams({ 'g-recaptcha-response': token }),
  });

  const query =
    ctx.media.type === 'movie'
      ? `?tmdb=${ctx.media.tmdbId}`
      : `?tmdb=${ctx.media.tmdbId}&season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`;

  return {
    embeds: [
      {
        embedId: smashyStreamFScraper.id,
        url: `${baseUrl}/getplayer.php${query}&player=f`,
      },
      {
        embedId: smashyStreamOScraper.id,
        url: `${baseUrl}/getplayer.php${query}&player=o`,
      },
    ],
  };
};

export const smashyStreamScraper = makeSourcerer({
  id: 'smashystream',
  name: 'SmashyStream',
  rank: 30,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper,
});
