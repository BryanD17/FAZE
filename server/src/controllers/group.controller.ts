import type { Request, Response } from 'express';
import type { CreateGroup, GroupListQuery } from '@faze/shared';

import { groupService, parseGroupId } from '../services/group.service.js';

export const groupController = {
  async list(req: Request, res: Response) {
    res.status(200).json(await groupService.list(req.query as unknown as GroupListQuery));
  },

  async create(req: Request, res: Response) {
    res.status(201).json(await groupService.create(req.user!.userId, req.body as CreateGroup));
  },

  async detail(req: Request, res: Response) {
    res.status(200).json(await groupService.detail(parseGroupId(req.params.id), req.user!.userId));
  },

  async join(req: Request, res: Response) {
    res.status(200).json(await groupService.join(req.user!.userId, parseGroupId(req.params.id)));
  },

  async leave(req: Request, res: Response) {
    res.status(200).json(await groupService.leave(req.user!.userId, parseGroupId(req.params.id)));
  },
};
