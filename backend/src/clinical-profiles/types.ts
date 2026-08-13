import { z } from 'zod'

export const PROFILE_IDS = ['adult-acute-urti', 'adult-acute-uncomplicated-uti'] as const

export const ProfileIdSchema = z.enum(PROFILE_IDS)

export type ProfileId = z.infer<typeof ProfileIdSchema>
