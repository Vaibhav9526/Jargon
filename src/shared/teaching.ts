export interface TeachingAttachment {
  path: string;
  name: string;
}

export interface TeachingRequest {
  topic: string;
  attachments: TeachingAttachment[];
}

export interface TeachingAgent {
  id: string;
  name: string;
  character?: string;
  isGod?: boolean;
  isAssistant?: boolean;
}

export const MAX_TEACHING_TEXT_CHARS = 32768;
/**
 * Topic ceiling for a hosted OpenMAIC generation.
 *
 * This is the adapter's own verified limit (`LIMITS.maxRequirementChars` in
 * `src/main/openMaic.ts`), not a round number: it is what the requirement field
 * will accept before an over-long one is rejected. Matching it here means the
 * topic is refused at parse time — in the composer, before a job exists — rather
 * than after an upload or a billable submission has already started.
 */
export const MAX_TEACHING_TOPIC_CHARS = 8000;
export const MAX_TEACHING_ATTACHMENTS = 32;
export const MAX_TEACHING_PATH_CHARS = 4096;
export const MAX_TEACHING_NAME_CHARS = 255;

const TEACHING_ALIAS = /(^|[\s([{\u0022'“‘«])@(?:teach-me|teacher)(?=$|[\s)\]}\u0022'”’»]|[.,:!?]+(?=$|[\s)\]}\u0022'”’»]))/gi;
const ALLOWED_EXTENSION = /\.(?:pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i;
const INVALID_FILE_CHAR = /[\u0000-\u001f\u007f]/;

export function parseTeachingRequest(
  text: string,
  attachments: readonly TeachingAttachment[]
): TeachingRequest | null {
  if (typeof text !== 'string') throw new TypeError('Teaching text must be a string.');

  let teaching = false;
  const topic = text.replace(TEACHING_ALIAS, (_alias, prefix: string) => {
    teaching = true;
    return prefix;
  }).trim();
  if (!teaching) return null;

  if (text.length > MAX_TEACHING_TEXT_CHARS) {
    throw new RangeError(`Teaching message must be ${MAX_TEACHING_TEXT_CHARS} characters or fewer.`);
  }
  if (topic.length > MAX_TEACHING_TOPIC_CHARS) {
    throw new RangeError(`Teaching topic must be ${MAX_TEACHING_TOPIC_CHARS} characters or fewer.`);
  }
  if (!Array.isArray(attachments)) throw new TypeError('Teaching attachments must be an array.');
  if (attachments.length > MAX_TEACHING_ATTACHMENTS) {
    throw new RangeError(`Teaching supports up to ${MAX_TEACHING_ATTACHMENTS} attachments.`);
  }

  const files: TeachingAttachment[] = [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
      || typeof attachment.path !== 'string' || typeof attachment.name !== 'string'
      || !attachment.path.trim() || !attachment.name.trim()
      || INVALID_FILE_CHAR.test(attachment.path) || INVALID_FILE_CHAR.test(attachment.name)
      || /[\\/]/.test(attachment.name)) {
      throw new TypeError('Each teaching attachment needs a valid path and file name.');
    }
    if (attachment.path.length > MAX_TEACHING_PATH_CHARS
      || attachment.name.length > MAX_TEACHING_NAME_CHARS) {
      throw new RangeError(`Teaching attachment paths must be ${MAX_TEACHING_PATH_CHARS} characters or fewer and names ${MAX_TEACHING_NAME_CHARS} or fewer.`);
    }
    if (!ALLOWED_EXTENSION.test(attachment.path) || !ALLOWED_EXTENSION.test(attachment.name)) {
      throw new Error('Teaching attachments must be PDF or PNG, JPG, JPEG, WEBP, GIF, BMP, TIF, TIFF images.');
    }
    files.push({ path: attachment.path, name: attachment.name });
  }

  if (!topic && files.length === 0) throw new Error('Add a teaching topic or a PDF/image attachment.');
  return { topic, attachments: files };
}

export function findTeacherAgent<T extends TeachingAgent>(agents: readonly T[]): T | undefined {
  const isWorker = (agent: T): boolean => !agent.isGod && !agent.isAssistant;
  return agents.find((agent) => isWorker(agent) && agent.character === 'teacher')
    ?? agents.find((agent) => isWorker(agent) && agent.name.toLowerCase() === 'teacher');
}
