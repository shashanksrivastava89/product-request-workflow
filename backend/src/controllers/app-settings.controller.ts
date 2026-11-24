import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prismaService } from '../services/prisma.service';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  WIZARD_STEP2_DATA_BANNER_KEY,
  WIZARD_STEP2_DATA_BANNER_DEFAULT,
} from '../constants/app-settings.constants';

export const getWizardStep2DataBanner = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let text = await prismaService.getAppSetting(WIZARD_STEP2_DATA_BANNER_KEY);
    if (text === null) {
      text = WIZARD_STEP2_DATA_BANNER_DEFAULT;
      await prismaService.upsertAppSetting(WIZARD_STEP2_DATA_BANNER_KEY, text);
    }
    res.json({ message: text });
  } catch (error) {
    next(error);
  }
};

const putBannerSchema = z.object({
  message: z.string().max(2000),
});

export const putWizardStep2DataBanner = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { message } = putBannerSchema.parse(req.body);
    const trimmed = message.trim();
    await prismaService.upsertAppSetting(WIZARD_STEP2_DATA_BANNER_KEY, trimmed);
    res.json({ message: trimmed });
  } catch (error) {
    next(error);
  }
};
