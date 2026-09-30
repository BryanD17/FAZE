import type { Request, Response } from 'express';
import type {
  GameLibraryCreate,
  GameLibraryPatch,
  LocalAvailabilitySlot,
  PlatformSet,
  ProfilePatch,
  TagSet,
} from '@faze/shared';

import { profileService } from '../services/profile.service.js';

export const profileController = {
  async me(req: Request, res: Response) {
    res.status(200).json(await profileService.me(req.user!.userId));
  },

  async update(req: Request, res: Response) {
    res.status(200).json(await profileService.update(req.user!.userId, req.body as ProfilePatch));
  },

  async platforms(req: Request, res: Response) {
    const body = req.body as PlatformSet;

    res.status(200).json(await profileService.setPlatforms(req.user!.userId, body.platformIds));
  },

  async tags(req: Request, res: Response) {
    const body = req.body as TagSet;

    res.status(200).json(await profileService.setTags(req.user!.userId, body.tagIds));
  },

  async addGame(req: Request, res: Response) {
    res
      .status(201)
      .json(await profileService.addGame(req.user!.userId, req.body as GameLibraryCreate));
  },

  async updateGame(req: Request, res: Response) {
    res
      .status(200)
      .json(
        await profileService.updateGame(
          req.user!.userId,
          Number(req.params.gameId),
          req.body as GameLibraryPatch,
        ),
      );
  },

  async removeGame(req: Request, res: Response) {
    await profileService.removeGame(req.user!.userId, Number(req.params.gameId));

    res.status(204).end();
  },

  async games(req: Request, res: Response) {
    res.status(200).json(await profileService.games(req.user!.userId));
  },

  async setAvailability(req: Request, res: Response) {
    res
      .status(200)
      .json(
        await profileService.setAvailability(req.user!.userId, req.body as LocalAvailabilitySlot[]),
      );
  },

  async availability(req: Request, res: Response) {
    res.status(200).json(await profileService.availability(req.user!.userId));
  },

  async publicProfile(req: Request, res: Response) {
    res
      .status(200)
      .json(await profileService.publicProfile(req.params.displayName!, req.user?.userId ?? null));
  },

  async completeness(req: Request, res: Response) {
    res.status(200).json(await profileService.completeness(req.user!.userId));
  },
};
