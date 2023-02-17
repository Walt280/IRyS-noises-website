import child_process from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
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

async function encode_audio(raw_audio_dir, compressed_audio_dir, bitrate) {
    const promise_exec = util.promisify(child_process.exec);

    console.log("Checking for ffmpeg with libopus...");
    try {
        await promise_exec("ffmpeg -loglevel error -y -f lavfi -i sine=frequency=1000:duration=1 -c:a libopus test.opus");
        console.log("\tFound suitable ffmpeg.");
        await fsp.rm("test.opus");
    }
    catch (error) {
        console.log("ffmpeg check failed, no ffmpeg with libopus found!")
        throw error;
    }
    const valid_extensions = [ ".mp3", ".wav" ];
    console.log(`Searching for audio files in ${raw_audio_dir} ending with ${valid_extensions.join("/")}.`)
    const input_files = (await walk_fs_tree(raw_audio_dir))
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
            console.log(`${path.relative(raw_audio_dir, elem)} has similar name to ${path.relative(raw_audio_dir, f)}!`)
            matched.push(f);
            matched.push(elem);
        }
    });

    if(matched.length > 0) {
        console.log("Similar file names found in raw audio folder! These must be corrected before continuing.");
        throw new Error("Similar file names found in raw audio folder! These must be corrected before continuing.");
    }
    console.log("\tNo files matched.")

    let progress_bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    try {
        console.log("Encoding files on all cores...")
        progress_bar.start(input_files.length, 0);

        await bluebird.Promise.map(input_files, async (input_file) => {
            let input_rel_path = path.relative(raw_audio_dir, input_file);
            let output_path = path.join(
                compressed_audio_dir, 
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
                await promise_exec(`ffmpeg -loglevel error -y -i "${input_file}" -c:a libopus -b:a ${bitrate} "${output_path}"`);
            }
            
            progress_bar.increment();
        }, { concurrency: os.cpus().length });
    }
    catch (error) {
        console.log("audio encode failed!")
        throw error;
    }
    finally {
        progress_bar.stop();
    }
}

let viteConfig = null;

export default function compressAudio({ rawAudioDir = '', compressedAudioDir = '', bitrate = 160000}) {
    return {
        name: 'compressAudioPlugin',
        order: 'post',
        sequential: 'true',
        configResolved(resolvedConfig) {
            viteConfig = resolvedConfig;
        },
        async buildStart() {
            if(!rawAudioDir) {
                throw new Error("rawAudioDir cannot be empty!");
            }

            if(!compressedAudioDir) {
                throw new Error("compressedAudioDir cannot be empty!");
            }

            if(bitrate < 0 || bitrate > 256000) {
                throw new Error("bitrate must be between 0 and 512000");
            }

            await encode_audio(path.resolve(rawAudioDir), compressedAudioDir, bitrate);
        },
        async writeBundle() {
            if(viteConfig.command === "build") {
                let fileList = await walk_fs_tree(compressedAudioDir);
                let buildDirName = viteConfig?.build?.outDir || 'dist';
                let buildDir = path.resolve(buildDirName);
                
                let copyProgressBar = new cliProgress.SingleBar({
                    format: `Copying compressed audio to ${buildDirName}: {bar} {percentage}% | ETA: {eta}s | {value}/{total}`
                }, cliProgress.Presets.shades_classic);
                copyProgressBar.start(fileList.length, 0);
                for(let file of fileList) {
                    let relPath = path.relative(compressedAudioDir, file);
                    let buildDirPath = path.resolve(buildDir, relPath);
                    await fsp.mkdir(path.dirname(buildDirPath), { recursive: true });
                    await fsp.copyFile(file, buildDirPath);
                    copyProgressBar.increment();
                }
                copyProgressBar.stop();
            }
        }
    }
}
