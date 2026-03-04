package fileformat_test

import (
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestFileformat(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Fileformat Suite")
}
