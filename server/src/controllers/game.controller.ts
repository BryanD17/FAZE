import type { Request, Response } from 'express';
import type { GameSearchQuery } from '@faze/shared';

import { gameService } from '../services/game.service.js';

export const gameController = {
  async search(req: Request, res: Response) {
    res.status(200).json(await gameService.search(req.query as unknown as GameSearchQuery));
  },

  async popular(_req: Request, res: Response) {
    res.status(200).json(await gameService.popular());
  },
};
