// const select = require(`unist-util-select`)
const cheerio = require(`cheerio`)
const isRelativeUrl = require(`is-relative-url`)
const path = require(`path`)
const slash = require(`slash`)
const visitWithParents = require(`unist-util-visit-parents`)
const _ = require(`lodash`)


module.exports = async (
    { files, markdownNode, markdownAST, pathPrefix, getNode, reporter, cache }, pluginOptions
) => {

    const findParentLinks = ({ children }) =>
        children.some(
            node =>
                (node.type === `html` && !!node.value.match(/<a /)) ||
                node.type === `link`
        )

    // This will allow the use of html image tags
    // const rawHtmlNodes = select(markdownAST, `html`)
    let rawHtmlNodes = []
    visitWithParents(markdownAST, `html`, (node, ancestors) => {
        const inLink = ancestors.some(findParentLinks)

        rawHtmlNodes.push({ node, inLink })
    })

    const generateImagesAndUpdateNode = async function(node, resolve, inLink) {
        // Check if this markdownNode has a File parent. This plugin
        // won't work if the image isn't hosted locally.
        const parentNode = getNode(markdownNode.parent)
        let imagePath
        if (parentNode && parentNode.dir) {
            imagePath = slash(path.join(parentNode.dir, node.url))
        } else {
            return null
        }

        const imageNode = _.find(files, file => {
            if (file && file.absolutePath) {
                return file.absolutePath === imagePath
            }
            return null
        })

        if (!imageNode || !imageNode.absolutePath) {
            return resolve()
        }

        let fluidResult = await fluid({
            file: imageNode,
            args: options,
            reporter,
            cache,
        })

        if (!fluidResult) {
            return resolve()
        }

        const originalImg = fluidResult.originalImg
        const fallbackSrc = fluidResult.src
        const srcSet = fluidResult.srcSet
        const presentationWidth = fluidResult.presentationWidth

        // Generate default alt tag
        const srcSplit = node.url.split(`/`)
        const fileName = srcSplit[srcSplit.length - 1]
        const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ``)
        const defaultAlt = fileNameNoExt.replace(/[^A-Z0-9]/gi, ` `)

        const imageStyle = `
            width: 100%;
            height: 100%;
            margin: 0;
            vertical-align: middle;
            position: absolute;
            top: 0;
            left: 0;
            box-shadow: inset 0px 0px 0px 400px ${options.backgroundColor};`.replace(
            /\s*(\S+:)\s*/g,
            `$1`
        )

        // Create our base image tag
        let imageTag = `
            <img
                class="${imageClass}"
                style="${imageStyle}"
                alt="${node.alt ? node.alt : defaultAlt}"
                title="${node.title ? node.title : ``}"
                src="${fallbackSrc}"
                srcset="${srcSet}"
                sizes="${fluidResult.sizes}"
            />
        `.trim()

        // if options.withWebp is enabled, generate a webp version and change the image tag to a picture tag
        if (options.withWebp) {
            const webpFluidResult = await fluid({
                file: imageNode,
                args: _.defaults(
                    { toFormat: `WEBP` },
                    // override options if it's an object, otherwise just pass through defaults
                    options.withWebp === true ? {} : options.withWebp,
                    pluginOptions,
                    defaults
                ),
                reporter,
            })

            if (!webpFluidResult) {
                return resolve()
            }

            imageTag = `
            <picture>
                <source
                    srcset="${webpFluidResult.srcSet}"
                    sizes="${webpFluidResult.sizes}"
                    type="${webpFluidResult.srcSetType}"
                />
                <source
                    srcset="${srcSet}"
                    sizes="${fluidResult.sizes}"
                    type="${fluidResult.srcSetType}"
                />
                <img
                    class="${imageClass}"
                    style="${imageStyle}"
                    src="${fallbackSrc}"
                    alt="${node.alt ? node.alt : defaultAlt}"
                    title="${node.title ? node.title : ``}"
                />
            </picture>
            `.trim()
        }

        const ratio = `${(1 / fluidResult.aspectRatio) * 100}%`

        // Construct new image node w/ aspect ratio placeholder
        const showCaptions = options.showCaptions && node.title
        let rawHTML = `
    <span
        class="${imageWrapperClass}"
        style="position: relative; display: block; ${
            showCaptions ? `` : options.wrapperStyle
        } max-width: ${presentationWidth}px; margin-left: auto; margin-right: auto;"
    >
        <span
            class="${imageBackgroundClass}"
            style="padding-bottom: ${ratio}; position: relative; bottom: 0; left: 0; background-image: url('${
            fluidResult.base64
        }'); background-size: cover; display: block;"
        ></span>
        ${imageTag}
    </span>
    `.trim()

        // Make linking to original image optional.
        if (!inLink && options.linkImagesToOriginal) {
            rawHTML = `
    <a
        class="gatsby-resp-image-link"
        href="${originalImg}"
        style="display: block"
        target="_blank"
        rel="noopener"
    >
        ${rawHTML}
    </a>
        `.trim()
        }

        // Wrap in figure and use title as caption
        if (showCaptions) {
            rawHTML = `
    <figure class="gatsby-resp-image-figure" style="${options.wrapperStyle}">
        ${rawHTML}
        <figcaption class="gatsby-resp-image-figcaption">${node.title}</figcaption>
    </figure>
            `.trim()
        }

        return rawHTML
    }

    console.log("rawHtmlNodes", rawHtmlNodes)

    rawHtmlNodes.map(({ node, inLink }) => {
        new Promise(async (resolve, reject) => {
            console.log("node.value", node.value)
            if (!node.value) {
                return resolve()
            }

            const $ = cheerio.load(node.value)
            if ($(`img`).length === 0) {
                // No img tags
                return resolve()
            }

            let imageRefs = []
            $(`img`).each(function() {
                imageRefs.push($(this))
            })

            console.log("imageRefs", imageRefs)


            for (let thisImg of imageRefs) {
                // Get the details we need.
                let formattedImgTag = {}
                formattedImgTag.url = thisImg.attr(`src`)
                formattedImgTag.title = thisImg.attr(`title`)
                formattedImgTag.alt = thisImg.attr(`alt`)

                console.log("thisImg", thisImg)
                console.log("formattedImgTag.url", formattedImgTag.url)

                if (!formattedImgTag.url) {
                    return resolve()
                }

                const fileType = formattedImgTag.url.slice(-3)
                console.log("fileType", fileType)
                console.log("isRelativeUrl(formattedImgTag.url)", isRelativeUrl(formattedImgTag.url))
                // Ignore gifs as we can't process them,
                // svgs as they are already responsive by definition
                if (
                    isRelativeUrl(formattedImgTag.url) &&
                    fileType !== `gif` &&
                    fileType !== `svg`
                ) {
                    console.log("INSIDE IF")
                    const rawHTML = await generateImagesAndUpdateNode(
                        formattedImgTag,
                        resolve,
                        inLink
                    )
                    console.log("rawHTML IN IF", rawHTML)
                    if (rawHTML) {
                        // Replace the image string
                        // thisImg.replaceWith(rawHTML)
                        thisImg.replaceWith(rawHTML)

                    } else {
                        return resolve()
                    }
                }
            }


        })

    })

}
