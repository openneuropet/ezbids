"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const archiver = require("archiver");
const async = require("async");
const config = require("./config");
const models = require("./models");
const upload = multer(config.multer);
const router = express.Router();
/*
//TODO - what is this for?
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(__dirname,'/uploads'))
    },
    filename: function (req, file, cb) {
      let fileExtension = file.originalname.split('.')[1]
      cb(null, file.fieldname + '-' + Date.now()+'.'+fileExtension)
    }
})
*/
router.get('/health', (req, res, next) => {
    let status = "ok";
    let message = "";
    //check to see if we can access the workdir
    try {
        fs.writeFileSync(config.workdir + '/health.txt', "test");
    }
    catch (err) {
        status = "failed";
        message = err;
    }
    res.json({ status, message });
});
router.post('/session', (req, res, next) => {
    req.body.status = "created";
    req.body.request_headers = req.headers;
    let session = new models.Session(req.body);
    session.save().then(_session => {
        res.json(_session);
    }).catch(err => {
        next(err);
    });
});
router.get('/session/:session_id', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        res.json(session);
    }).catch(err => {
        next(err);
    });
});
router.post('/session/:session_id/deface', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        if (!session)
            return next("no such session");
        fs.writeFile(config.workdir + "/" + session._id + "/deface.json", JSON.stringify(req.body), err => {
            session.status = "deface";
            session.status_msg = "Waiting to be defaced";
            session.save().then(() => {
                res.send("ok");
            });
        });
    });
});
router.post('/session/:session_id/canceldeface', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        if (!session)
            return next("no such session");
        //request deface.cancel by writing out "deface.cancel" file
        console.debug("writing .cancel");
        fs.writeFile(config.workdir + "/" + session._id + "/.cancel", "", err => {
            if (err)
                console.error(err);
            session.status_msg = "requested to cancel defacing";
            //handler should set the status when the job is killed so this shouldn't 
            //be necessary.. but right not kill() doesn't work.. so 
            session.deface_begin_date = undefined;
            session.status = "analyzed";
            session.save().then(() => {
                res.send("ok");
            });
        });
    });
});
router.post('/session/:session_id/resetdeface', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        if (!session)
            return next("no such session");
        try {
            const workdir = config.workdir + "/" + session._id;
            console.log("removing deface output");
            if (fs.existsSync(workdir + "/deface.finished")) {
                fs.unlinkSync(workdir + "/deface.finished");
            }
            if (fs.existsSync(workdir + "/deface.failed")) {
                fs.unlinkSync(workdir + "/deface.failed");
            }
            session.status = "analyzed";
            session.status_msg = "reset defacing";
            session.deface_begin_date = undefined;
            session.deface_finish_date = undefined;
            session.save().then(() => {
                res.send("ok");
            });
        }
        catch (err) {
            console.error(err);
            res.send(err);
        }
    });
});
router.post('/session/:session_id/finalize', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        if (!session)
            return next("no such session");
        fs.writeFile(config.workdir + "/" + session._id + "/finalized.json", JSON.stringify(req.body), err => {
            models.ezBIDS.findOneAndUpdate({ _session_id: req.params.session_id }, { $set: {
                    updated: req.body,
                    update_date: new Date(),
                } }).then(err => {
                session.status = "finalized";
                session.status_msg = "Waiting to be finalized";
                session.save().then(() => {
                    res.send("ok");
                });
            });
        });
    });
});
//download finalized(updated) content
router.get('/session/:session_id/updated', (req, res, next) => {
    models.ezBIDS.findOne({ _session_id: req.params.session_id }).then(ezbids => {
        if (!ezbids)
            return next("no such session or ezbids not finalized");
        if (!ezbids.updated)
            return next("not yet finalized");
        res.json(ezbids.updated);
    });
});
//let user download files within session (like the .png image generated by analyzer)
router.get('/download/:session_id/*', (req, res, next) => {
    models.Session.findById(req.params.session_id).then(session => {
        let basepath = config.workdir + "/" + session._id;
        //validate path so it will be inside the basepath
        let fullpath = path.resolve(basepath + "/" + req.params[0]);
        if (!fullpath.startsWith(basepath))
            return next("invalid path");
        //TODO - if requested path is a file, thenstream
        let stats = fs.lstatSync(fullpath);
        if (stats.isFile()) {
            res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(fullpath));
            fs.createReadStream(fullpath).pipe(res);
        }
        else if (stats.isDirectory()) {
            res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(fullpath) + ".zip");
            const archive = archiver('zip', {
                zlib: { level: 0 }
            });
            archive.directory(fullpath, 'bids');
            archive.finalize();
            archive.pipe(res);
        }
        else
            next("unknown file");
        //TODO - if it's directory, then send an archive down
    }).catch(err => {
        next(err);
    });
});
router.post('/upload-multi/:session_id', upload.any(), (req, res, next) => {
    //when a single file is uploaded paths becomes just a string. convert it to an array of 1
    let paths = req.body["paths"];
    if (!Array.isArray(paths))
        paths = [paths];
    //same for mtimes
    let mtimes = req.body["mtimes"];
    if (!Array.isArray(mtimes))
        mtimes = [mtimes];
    models.Session.findById(req.params.session_id).then((session) => __awaiter(void 0, void 0, void 0, function* () {
        let idx = -1;
        async.eachSeries(req.files, (file, next_file) => {
            idx++;
            const src_path = file.path;
            /* //file
11|ezbids- | {
11|ezbids- |   fieldname: 'files',
11|ezbids- |   originalname: 'i1848324.MRDC.82',
11|ezbids- |   encoding: '7bit',
11|ezbids- |   mimetype: 'application/octet-stream',
11|ezbids- |   destination: '/mnt/ezbids/upload',
11|ezbids- |   filename: '2d682c5694b0fb8da2beeea3e670350a',
11|ezbids- |   path: '/mnt/ezbids/upload/2d682c5694b0fb8da2beeea3e670350a',
11|ezbids- |   size: 147882
11|ezbids- | }
            */
            //let dirty_path = config.workdir+"/"+req.params.session_id+"/"+req.body.path;
            const dirty_path = config.workdir + "/" + req.params.session_id + "/" + paths[idx];
            const dest_path = path.resolve(dirty_path);
            const mtime = mtimes[idx] / 1000; //browser uses msec.. filesystem uses sec since epoch
            if (!dest_path.startsWith(config.workdir))
                return next_file("invalid path:", dest_path);
            const destdir = path.dirname(dest_path);
            //move the file over to workdir
            const made = mkdirp.sync(destdir);
            fs.renameSync(src_path, dest_path);
            if (mtime)
                fs.utimesSync(dest_path, mtime, mtime);
            next_file();
        }, err => {
            if (err)
                return next(err);
            res.send("ok");
        });
    })).catch(err => {
        console.error(err);
        next(err);
    });
});
//done uploading.
router.patch('/session/uploaded/:session_id', (req, res, next) => {
    models.Session.findByIdAndUpdate(req.params.session_id, {
        status: "uploaded",
        status_msg: "Waiting in the queue..",
        upload_finish_date: new Date()
    }).then(session => {
        if (!session)
            return next("no such session");
        res.send("ok");
    }).catch(err => {
        console.error(err);
        next(err);
    });
});
module.exports = router;
//# sourceMappingURL=controllers.js.map