import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';

const directory = join(process.cwd(), 'public', 'img', 'mood');
const sources = (await readdir(directory)).filter(
  (file) => extname(file).toLowerCase() === '.jpg',
);

for (const source of sources) {
  const target = join(directory, `${basename(source, '.jpg')}.avif`);
  await sharp(join(directory, source))
    .resize({ width: 1600, withoutEnlargement: true })
    .avif({ quality: 58 })
    .toFile(target);
  console.log(`Created ${basename(target)}`);
}
