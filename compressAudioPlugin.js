import child_process from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import util from 'node:util';

import bluebird from 'bluebird';
import cliProgress from 'cli-progress';

async function walk_fs_tree(input_path) {
    const files = await fsp.readdir(input_path, {withFileTypes: true});

    let result = new Array();
    for(const file of files) {
        if(file.isDirectory()) {
            let subdir_result = await walk_fs_tree(path.join(input_path, file.name));
            subdir_result.forEach(element => result.push(element));
        }
        else if(file.isFile()) {
            result.push(path.join(input_path, file.name));
        }
    }

    return result;
}

async function encode_audio(input_audio_dir, output_audio_dir) {
    const promise_exec = util.promisify(child_process.exec);

    console.log("Checking for ffmpeg with libopus...");
    try {
        await promise_exec("ffmpeg -loglevel error -y -f lavfi -i sine=frequency=1000:duration=1 -c:a libopus test.opus");
        console.log("\tFound suitable ffmpeg.");
        await fsp.rm("test.opus");
    }
    catch (e) {
        console.log("ffmpeg check failed!")
        console.log(`${e.name}: ${e.message}`);
        console.log('stdout');
        console.log(e.stdout);
        console.log('stderr');
        console.log(e.stderr);
    }
    const valid_extensions = [ ".mp3", ".wav" ];
    console.log(`Searching for audio files in ${input_audio_dir} ending with ${valid_extensions.join("/")}.`)
    const input_files = (await walk_fs_tree(input_audio_dir))
        .filter((elem) => {
            let ext = path.extname(elem);
            if(valid_extensions.includes(ext)) {
                return true;
            }
            else {
                console.log(`Found a weird file in audio files: ${elem}`);
                return false;
            }
        });
    console.log(`\tFound ${input_files.length} file${input_files.length === 1 ? "" : "s"}`);
    
    console.log("Checking for files that only differ by extension...")
    let matched = new Array();
    input_files.forEach((elem, index, array) => {
        let elem_parts = path.parse(elem);
        let f = array.find((elem2) => {
            let elem2_parts = path.parse(elem2);
            return elem_parts.dir === elem2_parts.dir &&
                elem_parts.name === elem2_parts.name &&
                elem_parts.ext !== elem2_parts.ext;
        });
        if(f && matched.find((e) => f === e) === undefined && matched.find(e => elem === e) === undefined) {
            console.log(`${path.relative(input_audio_dir, elem)} has similar name to ${path.relative(input_audio_dir, f)}!`)
            matched.push(f);
            matched.push(elem);
        }
    });

    if(matched.length > 0) {
        console.log("Similar file names found! These must be corrected before continuing.");
        process.exit(1);
    }
    console.log("\tNo files matched.")

    let progress_bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    try {
        console.log("Encoding files on all cores...")
        progress_bar.start(input_files.length, 0);

        await bluebird.Promise.map(input_files, async (input_file) => {
            let input_rel_path = path.relative(input_audio_dir, input_file);
            let output_path = path.join(
                output_audio_dir, 
                path.dirname(input_rel_path), 
                path.basename(input_file, path.extname(input_file)) + ".opus");
            await fsp.mkdir(path.dirname(output_path), { recursive: true });
            
            let input_modified = (await fsp.stat(input_file, { bigint: true })).mtimeMs;
            let output_modified = 0;
            try {
                output_modified = (await fsp.stat(output_path, { bigint: true })).mtimeMs;
            }
            catch (e) { }

            if(input_modified > output_modified) {
                await promise_exec(`ffmpeg -loglevel error -y -i "${input_file}" -c:a libopus -b:a 160000 "${output_path}"`);
            }
            
            progress_bar.increment();
        }, { concurrency: os.cpus().length });
    }
    catch (e) {
        console.log("audio encode failed!")
        console.log(`${e.name}: ${e.message}`);
        console.log('stdout');
        console.log(e.stdout);
        console.log('stderr');
        console.log(e.stderr);
    }
    finally {
        progress_bar.stop();
    }
}

let viteConfig = null;

export default function compressAudio({ input_audio_dir = '', output_folder = ''}) {
    return {
        name: 'compressAudioPlugin',
        order: 'pre',
        sequential: 'true',
        configResolved(resolvedConfig) {
            viteConfig = resolvedConfig;
        },
        async buildStart() {
            if(!input_audio_dir) {
                throw new Error("input_audio_dir cannot be empty!");
            }
            const output_audio_dir = path.resolve(viteConfig?.build?.outDir || 'dist', output_folder);
            await encode_audio(path.resolve(input_audio_dir), output_audio_dir);
        }
    }
}
