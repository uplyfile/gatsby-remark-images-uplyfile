const cheerio = require(`cheerio`)
const select = require(`unist-util-select`)


module.exports = async (
    { files, markdownNode, markdownAST, pathPrefix, getNode, reporter, cache }, pluginOptions
) => {

    const markdownImageNodes = select(markdownAST, `image`)

    const rawHtmlNodes = select(markdownAST, `html`)

    rawHtmlNodes.map(node => {
        const $ = cheerio.load(node.value)
        if ($(`img`).length === 0){
            return ''
        }

        let imageRefs = []
        $(`img`).each(function() {
            imageRefs.push($(this))
        })

        for (let thisImg of imageRefs) {
            console.log("SRC", thisImg.attr(`src`))
            console.log("TITLE", thisImg.attr(`title`))
            console.log("ALT", thisImg.attr(`alt`))
        }
    })

}
