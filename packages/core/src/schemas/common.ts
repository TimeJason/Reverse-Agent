import { z } from "zod";

export const TimestampSchema = z.iso.datetime({ offset: true });
export const MetadataSchema = z.record(z.string(), z.unknown());
export const NonEmptyStringSchema = z.string().min(1);
export const JsonObjectSchema = z.record(z.string(), z.unknown());
