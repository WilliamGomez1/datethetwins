const options = require('./options');

const { limits } = options;

class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.errors = errors;
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validates the JSON profile submitted with an application.
 * Returns a clean object containing only known fields; throws ValidationError.
 */
function validateProfile(raw, photoCounts) {
  const errors = [];
  const need = (cond, field, msg) => { if (!cond) errors.push({ field, message: msg }); };
  const text = (v, field, label, { required = true, max = limits.maxShortText } = {}) => {
    const s = str(v);
    if (required) need(s.length > 0, field, `${label} is required.`);
    need(s.length <= max, field, `${label} must be ${max} characters or fewer.`);
    return s.slice(0, max);
  };

  if (!raw || typeof raw !== 'object') throw new ValidationError([{ field: 'profile', message: 'Missing profile.' }]);

  const twins = Array.isArray(raw.twins) ? raw.twins.slice(0, 2) : [];
  need(twins.length === 2, 'twins', 'Both twins are required.');

  const cleanTwins = twins.map((t, i) => {
    const p = `twins.${i}`;
    t = t || {};
    const age = Number(t.age);
    need(Number.isInteger(age) && age >= limits.minAge && age <= limits.maxAge, `${p}.age`,
      `Age must be a whole number between ${limits.minAge} and ${limits.maxAge}.`);
    const prompts = Array.isArray(t.prompts) ? t.prompts.slice(0, limits.promptsPerTwin) : [];
    need(prompts.length === limits.promptsPerTwin, `${p}.prompts`, `Answer ${limits.promptsPerTwin} prompts.`);
    const seen = new Set();
    const cleanPrompts = prompts.map((pr, j) => {
      pr = pr || {};
      const prompt = str(pr.prompt);
      need(options.twinPrompts.includes(prompt), `${p}.prompts.${j}.prompt`, 'Choose a prompt from the list.');
      need(!seen.has(prompt), `${p}.prompts.${j}.prompt`, 'Pick three different prompts.');
      seen.add(prompt);
      return { prompt, answer: text(pr.answer, `${p}.prompts.${j}.answer`, 'Prompt answer', { max: limits.maxLongText }) };
    });
    const count = photoCounts[i] || 0;
    need(count >= limits.minPhotosPerTwin && count <= limits.maxPhotosPerTwin, `${p}.photos`,
      `Add between ${limits.minPhotosPerTwin} and ${limits.maxPhotosPerTwin} photos.`);
    return {
      name: text(t.name, `${p}.name`, 'First name', { max: 40 }),
      age,
      pronouns: text(t.pronouns, `${p}.pronouns`, 'Pronouns', { required: false, max: 30 }),
      occupation: text(t.occupation, `${p}.occupation`, 'Occupation', { required: false }),
      hometown: text(t.hometown, `${p}.hometown`, 'Hometown', { required: false }),
      height: text(t.height, `${p}.height`, 'Height', { required: false, max: 20 }),
      instagram: text(t.instagram, `${p}.instagram`, 'Instagram', { required: false, max: 40 }).replace(/^@/, ''),
      prompts: cleanPrompts,
    };
  });

  const pair = raw.pair || {};
  const twinType = str(pair.twinType);
  need(options.twinTypes.includes(twinType), 'pair.twinType', 'Choose a twin type.');
  const pairPrompt = pair.prompt || {};
  const pairPromptName = str(pairPrompt.prompt);
  need(options.pairPrompts.includes(pairPromptName), 'pair.prompt.prompt', 'Choose a prompt from the list.');

  const contact = raw.contact || {};
  const email = text(contact.email, 'contact.email', 'Email', { max: 120 }).toLowerCase();
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'contact.email', 'Enter a valid email address.');
  const phone = text(contact.phone, 'contact.phone', 'Phone', { required: false, max: 30 });
  need(!phone || /^[0-9+()\-.\s]{7,30}$/.test(phone), 'contact.phone', 'Enter a valid phone number.');

  const consent = raw.consent || {};
  need(consent.adults === true, 'consent.adults', 'Both of you must confirm you are 18 or older.');
  need(consent.agree === true, 'consent.agree', 'Both of you must agree to share this profile.');

  const clean = {
    twins: cleanTwins,
    pair: {
      twinType,
      city: text(pair.city, 'pair.city', 'City', { max: 60 }),
      prompt: { prompt: pairPromptName, answer: text(pairPrompt.answer, 'pair.prompt.answer', 'Prompt answer', { max: limits.maxLongText }) },
      why: text(pair.why, 'pair.why', 'Why you want to date the twins', { max: limits.maxLongText }),
    },
    contact: { email, phone },
    consent: { adults: true, agree: true },
  };

  if (errors.length) throw new ValidationError(errors);
  return clean;
}

module.exports = { validateProfile, ValidationError };
