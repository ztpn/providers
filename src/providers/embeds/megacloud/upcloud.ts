import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption, getCaptionTypeFromUrl, labelToLanguageCode } from '@/providers/captions';

interface StreamRes {
  server: number;
  sources: { file: string; type: string }[];
  tracks: {
    file: string;
    kind: 'captions' | 'thumbnails';
    label: string;
  }[];
}

export const megaCloudScraper = makeEmbed({
  id: 'megacloud',
  name: 'MegaCloud',
  rank: 305,
  async scrape(ctx) {
    const parsedUrl = new URL(ctx.url);

    const dataPath = parsedUrl.pathname.split('/');
    const dataId = dataPath[dataPath.length - 1];

    const streamRes = await ctx.proxiedFetcher<StreamRes>(
      `${parsedUrl.origin}/embed-2/ajax/e-1/getSources?id=${dataId}`,
      {
        headers: {
          Referer: parsedUrl.origin,
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );

    if (!streamRes.sources[0].file) throw new Error('Stream not found');

    const captions: Caption[] = [];
    streamRes.tracks.forEach((track) => {
      if (track.kind !== 'captions') return;
      const type = getCaptionTypeFromUrl(track.file);
      if (!type) return;
      const language = labelToLanguageCode(track.label.split(' ')[0]);
      if (!language) return;
      captions.push({
        id: track.file,
        language,
        hasCorsRestrictions: false,
        type,
        url: track.file,
      });
    });

    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: streamRes.sources[0].file,
          flags: [flags.CORS_ALLOWED],
          captions,
          preferredHeaders: {
            Referer: parsedUrl.origin,
            Origin: parsedUrl.origin,
          },
        },
      ],
    };
  },
});
