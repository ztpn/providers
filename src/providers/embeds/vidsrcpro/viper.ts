import { makeEmbed } from '@/providers/base';

import { jettScraper } from './jett';

export const viperScraper = makeEmbed({
  id: 'viper',
  name: 'Viper',
  rank: 301,
  async scrape(ctx) {
    // the scraping logic for both jett and viper is the same
    const result = await jettScraper.scrape(ctx);
    return {
      stream: result.stream,
    };
  },
});
